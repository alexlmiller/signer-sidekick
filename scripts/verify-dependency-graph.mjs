import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lock = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
// Fail even when a future Connect bump stops matching the version-scoped overrides.
for (const name of ["elliptic", "decode-uri-component"]) {
  assert(
    !new RegExp(`^  ['"]?${name}@`, "m").test(lock),
    `${name} returned to the dependency graph`,
  );
}
console.log("Dependency graph excludes elliptic and decode-uri-component");
