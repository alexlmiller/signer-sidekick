import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function walletIsolation(): Plugin {
  return {
    name: "verify-wallet-isolation",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
      const moduleIds = (chunk: (typeof chunks)[number]) => Object.keys(chunk.modules);
      const boundary = chunks.filter((chunk) =>
        moduleIds(chunk).some((id) =>
          /node_modules\/(?:@reown\/|@walletconnect\/|@solana\/|@base-org\/|@coinbase\/|@safe-global\/|\.pnpm\/zod@3\.)/.test(
            id,
          ),
        ),
      );
      const connect = chunks.filter((chunk) =>
        moduleIds(chunk).some((id) => id.includes("/node_modules/@stacks/connect/")),
      );
      if (!boundary.length || !connect.length)
        this.error("Wallet bundle boundary was not identified");
      const reachable = new Set<string>();
      const visit = (file: string) => {
        if (reachable.has(file)) return;
        reachable.add(file);
        const chunk = bundle[file];
        if (chunk?.type === "chunk") chunk.imports.forEach(visit);
      };
      // Initial app and real Connect SDK must not statically import the optional wallet subtree.
      chunks
        .filter((chunk) => chunk.isEntry || connect.includes(chunk))
        .forEach((chunk) => {
          visit(chunk.fileName);
        });
      const leaked = boundary.filter((chunk) => reachable.has(chunk.fileName));
      if (leaked.length)
        this.error(
          `Optional wallet code became eager: ${leaked.map((chunk) => chunk.fileName).join(", ")}`,
        );
      this.emitFile({
        type: "asset",
        fileName: ".vite/wallet-isolation.json",
        source: JSON.stringify({
          optionalChunks: boundary.map((chunk) => chunk.fileName),
          connectChunks: connect.map((chunk) => chunk.fileName),
        }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), walletIsolation()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3998",
      "/health": "http://127.0.0.1:3998",
      "/metrics": "http://127.0.0.1:3998",
    },
  },
});
