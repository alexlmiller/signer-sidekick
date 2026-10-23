import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const serverProjects = [
  "@stx-labs/signer-sidekick",
  "@stx-labs/signer-sidekick-protocol",
  "@stx-labs/signer-sidekick-api-contracts",
];

export function verifyDependencyGraph(lock, projects) {
  // Fail even when a future Connect bump stops matching the version-scoped overrides.
  for (const name of ["elliptic", "decode-uri-component"]) {
    assert(
      !new RegExp(`^  ['"]?${name}@`, "m").test(lock),
      `${name} returned to the dependency graph`,
    );
  }
  // Issue #65 permits only these Zod 3 versions, and never in server production dependencies.
  for (const [, version] of lock.matchAll(/^ {2}['"]?zod@(3\.[^:'"\s(]+)[^:\r\n]*:/gm)) {
    assert(
      ["3.22.4", "3.25.76"].includes(version),
      `zod@${version} is outside the reviewed exception in #65`,
    );
  }
  function visit(dependencies, parent) {
    for (const [alias, dependency] of Object.entries(dependencies ?? {})) {
      const name = dependency.from ?? alias;
      const path = `${parent} > ${name}@${dependency.version}`;
      assert(
        !dependency.isMissing && typeof dependency.version === "string",
        `Incomplete dependency: ${path}`,
      );
      assert(
        !(name === "zod" && dependency.version.startsWith("3.")) &&
          !/^@(reown|walletconnect)\//.test(name),
        `Optional wallet dependency entered server production graph: ${path}`,
      );
      visit(dependency.dependencies, path);
      visit(dependency.optionalDependencies, path);
    }
  }
  assert(Array.isArray(projects), "Expected a pnpm production dependency report");
  for (const name of serverProjects) {
    const project = projects.find((entry) => entry.name === name);
    assert(project?.dependencies, `Missing production dependency report for ${name}`);
    visit(project.dependencies, name);
    visit(project.optionalDependencies, name);
  }
}

if (import.meta.main) {
  const result = spawnSync(
    "pnpm",
    [
      ...serverProjects.flatMap((name) => ["--filter", name]),
      "list",
      "--prod",
      "--depth",
      "Infinity",
      "--json",
    ],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  assert(
    result.status === 0,
    result.error?.message || result.stderr || "Unable to read production dependency graph",
  );
  verifyDependencyGraph(
    readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8"),
    JSON.parse(result.stdout),
  );
  console.log(
    "Dependency graph excludes removed packages and keeps the Zod 3 exception out of the server",
  );
}
