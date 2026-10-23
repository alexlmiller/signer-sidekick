import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyDependencyGraph } from "./verify-dependency-graph.mjs";

const lock = `packages:
  zod@3.22.4:
  'zod@3.25.76':
  zod@4.6.6:
snapshots:
  zod@3.22.4: {}
  zod@3.25.76: {}
`;
function projects() {
  return [
    "@stx-labs/signer-sidekick",
    "@stx-labs/signer-sidekick-protocol",
    "@stx-labs/signer-sidekick-api-contracts",
  ].map((name) => ({ name, dependencies: { zod: { from: "zod", version: "4.6.6" } } }));
}

describe("dependency security boundaries", () => {
  it("allows the reviewed wallet versions outside the server and patched application Zod", () => {
    verifyDependencyGraph(lock, projects());
  });

  it("allows removal of the exception without pinning obsolete Zod versions in place", () => {
    verifyDependencyGraph("packages:\n  zod@4.6.6:\n", projects());
  });

  for (const name of ["elliptic", "decode-uri-component"]) {
    it(`rejects ${name} returning, including quoted lockfile keys`, () => {
      for (const quote of ["", "'", '"']) {
        assert.throws(
          () => verifyDependencyGraph(`${lock}  ${quote}${name}@1.0.0${quote}: {}\n`, projects()),
          /returned to the dependency graph/,
        );
      }
    });
  }

  it("rejects unreviewed Zod 3 versions and prereleases in package or snapshot keys", () => {
    for (const key of [
      "zod@3.26.0",
      "'zod@3.25.77'",
      '"zod@3.22.4-beta.1"',
      "zod@3.26.0(peer@1.0.0)",
    ]) {
      assert.throws(
        () => verifyDependencyGraph(`${lock}  ${key}: {}\n`, projects()),
        /outside the reviewed exception/,
      );
    }
  });

  for (const [name, version] of [
    ["zod", "3.22.4"],
    ["zod", "3.25.76"],
    ["@reown/appkit", "1.8.24"],
    ["@walletconnect/core", "2.23.7"],
  ]) {
    it(`rejects ${name}@${version} anywhere in each server project's production closure`, () => {
      for (let index = 0; index < 3; index++) {
        for (const kind of ["dependencies", "optionalDependencies"]) {
          const report = projects();
          report[index].dependencies.parent = {
            from: "parent",
            version: "1.0.0",
            [kind]: { alias: { from: name, version } },
          };
          assert.throws(
            () => verifyDependencyGraph(lock, report),
            /Optional wallet dependency entered server production graph: .* > parent@1\.0\.0 > /,
          );
        }
      }
    });
  }

  it("checks root optional dependencies but ignores development-only dependencies", () => {
    const report = projects();
    const optional = { zod: { from: "zod", version: "3.22.4" } };
    report[0].devDependencies = optional;
    verifyDependencyGraph(lock, report);
    report[0].optionalDependencies = optional;
    assert.throws(() => verifyDependencyGraph(lock, report), /entered server production graph/);
  });

  it("fails closed if a project report or dependency resolution is missing", () => {
    assert.throws(() => verifyDependencyGraph(lock, null), /Expected a pnpm/);
    assert.throws(() => verifyDependencyGraph(lock, projects().slice(1)), /Missing production/);
    const report = projects();
    report[0].dependencies.zod.isMissing = true;
    assert.throws(() => verifyDependencyGraph(lock, report), /Incomplete dependency/);
    delete report[0].dependencies.zod.isMissing;
    delete report[0].dependencies.zod.version;
    assert.throws(() => verifyDependencyGraph(lock, report), /Incomplete dependency/);
  });
});
