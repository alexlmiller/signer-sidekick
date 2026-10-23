import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { BrowserWalletIntent } from "@stx-labs/signer-sidekick-api-contracts";
import { browserWalletManifestSha256 } from "../../../apps/dashboard/src/features/operations/browser-wallet.js";
import { responseFor, snapshot } from "./large-pool-fixture.mjs";

// Uses the production build and real Connect SDK; only the injected extension is stubbed.
for (const providerName of ["Leather", "Xverse"] as const) {
  for (const cancelled of [false, true]) {
    test(`${providerName} ${cancelled ? "cancellation" : "submission"} leaves optional wallet code unloaded`, async ({
      page,
    }) => {
      const metadata = JSON.parse(
        readFileSync("apps/dashboard/dist/.vite/wallet-isolation.json", "utf8"),
      ) as {
        optionalChunks: string[];
        connectChunks: string[];
      };
      const requests: string[] = [];
      const sockets: string[] = [];
      page.on("request", (request) => requests.push(request.url()));
      page.on("websocket", (socket) => sockets.push(socket.url()));
      const address =
        providerName === "Xverse"
          ? "SP000000000000000000002Q6VF78"
          : snapshot.managerPrincipal.split(".")[0];
      const network = providerName === "Xverse" ? "mainnet" : "testnet";
      const txid = `0x${"ab".repeat(32)}`;
      const intent: BrowserWalletIntent = {
        schemaVersion: 2,
        id: "4e011bf7-f291-42c4-a35b-ab299a87ff8c",
        action: "update-fees",
        network,
        chainId: network === "mainnet" ? 1 : 0x80000000,
        requiredSender: address,
        createdAt: "2026-07-18T18:00:00.000Z",
        expiresAt: "2099-07-18T19:00:00.000Z",
        transaction: {
          method: "stx_callContract",
          params: {
            contract: `${address}.signer-manager`,
            functionName: "update-fees",
            functionArgs: [`0x01${"0".repeat(30)}fa`],
            network,
            address,
            sponsored: false,
            postConditionMode: "deny",
            postConditions: [],
          },
        },
        request: { action: "update-fees", actorPrincipal: address, feeBips: "250" },
        review: {
          title: "Update manager fee",
          summary: "Set fee to 250 basis points.",
          expectedPostState: "The fee is 250 basis points.",
          fields: [{ label: "Manager", value: `${address}.signer-manager` }],
        },
        seal: { factsSha256: "11".repeat(32), manifestSha256: "" },
        status: "prepared",
        txid: null,
        verification: null,
      };
      intent.seal.manifestSha256 = await browserWalletManifestSha256(intent);
      const calls: { method: string; params: unknown }[] = [];
      await page.exposeFunction("__walletRequest", (method: string, params: unknown) => {
        calls.push({ method, params });
        if (["getAddresses", "stx_getAddresses", "wallet_connect"].includes(method)) {
          if (cancelled)
            return { jsonrpc: "2.0", id: "fixture", error: { code: 4001, message: "Cancelled" } };
          return {
            jsonrpc: "2.0",
            id: "fixture",
            result: { addresses: [{ address, symbol: "STX", publicKey: `02${"12".repeat(32)}` }] },
          };
        }
        if (method !== "stx_callContract") throw new Error(`Unexpected method: ${method}`);
        return { jsonrpc: "2.0", id: "fixture", result: { txid: txid.slice(2) } };
      });
      await page.addInitScript((name) => {
        const controlled = window as typeof window & {
          __walletRequest(method: string, params?: unknown): Promise<unknown>;
          LeatherProvider?: unknown;
          XverseProviders?: unknown;
        };
        const provider = {
          request: (method: string, params?: unknown) => controlled.__walletRequest(method, params),
          ...(name === "Leather"
            ? { isLeather: true }
            : {
                signMultipleTransactions() {},
                createRepeatInscriptions() {},
              }),
        };
        if (name === "Leather") controlled.LeatherProvider = provider;
        else controlled.XverseProviders = { BitcoinProvider: provider };
      }, providerName);
      let recorded: unknown = null;
      await page.route("**/api/v1/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        let body = responseFor(route.request().url());
        if (path === "/api/v1/status") {
          body = {
            ...snapshot,
            network,
            managerPrincipal: `${address}.signer-manager`,
            preflight: {
              ...snapshot.preflight,
              node: { ...snapshot.preflight.node, networkId: intent.chainId },
            },
          };
        }
        if (path.startsWith("/api/v1/wallet-intents")) {
          if (path.endsWith("/submission")) {
            recorded = route.request().postDataJSON();
          }
          body = { intent: recorded ? { ...intent, status: "submitted", txid } : intent };
        }
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      });
      await page.goto("/");
      await page.getByLabel("Operator credential").fill("fixture-operator-token-32-characters");
      await page.getByRole("button", { name: "Open console" }).click();
      await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
      for (const hash of ["#rewards", "#settings"]) {
        await page.evaluate((value) => {
          location.hash = value;
        }, hash);
        await expect(
          page.getByRole("heading", {
            name: hash === "#rewards" ? "Rewards" : "Settings",
            exact: true,
          }),
        ).toBeVisible();
      }
      expect(
        requests.some((url) => metadata.connectChunks.some((file) => url.endsWith(file))),
      ).toBe(false);
      await page.evaluate((id) => {
        location.hash = `#action/update-fees?intentId=${id}`;
      }, intent.id);
      const wallet = page.getByRole("region", { name: "Browser wallet" });
      await wallet.getByRole("button", { name: "Connect wallet and sign" }).click();
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      if (cancelled) {
        await expect(wallet).toContainText("cancelled");
        expect(calls.some((call) => call.method === "stx_callContract")).toBe(false);
        expect(recorded).toBeNull();
      } else {
        await expect(wallet).toContainText("Transaction recorded; verification pending.");
        expect(calls.find((call) => call.method === "stx_callContract")?.params).toEqual(
          intent.transaction.params,
        );
        expect(recorded).toEqual({ txid });
      }
      expect(calls[0]?.method).toBe(providerName === "Xverse" ? "wallet_connect" : "getAddresses");
      expect(
        requests.some((url) => metadata.connectChunks.some((file) => url.endsWith(file))),
      ).toBe(true);
      expect(
        requests.filter((url) => metadata.optionalChunks.some((file) => url.endsWith(file))),
      ).toEqual([]);
      expect(
        [...requests, ...sockets].filter((url) => /walletconnect|reown|relay\./i.test(url)),
      ).toEqual([]);
    });
  }
}
