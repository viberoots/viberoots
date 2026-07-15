import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test("importer lockfile generation uses the explicit bounded command runner", async () => {
  const source = await fsp.readFile(
    path.join(root, "build-tools/tools/dev/update-pnpm-hash/importer-lockfile.ts"),
    "utf8",
  );

  assert.match(source, /import \{ runCommand \} from "\.\.\/filtered-flake-command"/);
  assert.match(source, /command: nixBin/);
  assert.match(source, /args: pnpmNixRunArgs\(opts\.flakeRef, args, nixEnv\)/);
  assert.match(source, /timeoutMs: opts\.timeoutMs/);
  assert.doesNotMatch(source, /\$\(/);

  const diagnostics = await fsp.readFile(
    path.join(root, "build-tools/tools/dev/filtered-flake-diagnostics.ts"),
    "utf8",
  );
  assert.match(diagnostics, /import \{ runCommand \} from "\.\/filtered-flake-command"/);
  assert.doesNotMatch(diagnostics, /\$\(/);

  const nix = await fsp.readFile(
    path.join(root, "build-tools/tools/dev/update-pnpm-hash/nix.ts"),
    "utf8",
  );
  assert.match(nix, /import \{ runCommand \} from "\.\.\/filtered-flake-command"/);
  assert.doesNotMatch(nix, /\$\(/);
});
