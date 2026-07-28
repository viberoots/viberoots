#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { validateUpdateTransactionTools } from "../../dev/update-command/run";

const root = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const read = async (relative: string) => await fsp.readFile(path.join(root, relative), "utf8");

test("update transaction rejects a final closure without gomod2nix", () => {
  const missing = "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-tools";
  assert.throws(
    () =>
      validateUpdateTransactionTools({
        PATH: `${missing}/bin`,
        VBR_ARTIFACT_TOOLS_ROOT: missing,
      }),
    /required tool not found on PATH: gomod2nix/,
  );
});

test("Rust resolution uses only canonical Nix-store Cargo", async () => {
  const source = await read("build-tools/tools/dev/install/cargo.ts");
  assert.match(source, /canonicalArtifactToolsRoot\(root\)/);
  assert.match(source, /ensureNixStoreToolPathSync\("cargo",/);
  assert.doesNotMatch(source, /UPDATE_CARGO_BIN|process\.env\.CARGO\b/);
  assert.match(
    await read("build-tools/tools/nix/flake/packages/remote-worker-tools.nix"),
    /workerPaths = \[[\s\S]*pkgs\.viberootsRustToolchain[\s\S]*pkgs\.gomod2nix[\s\S]*\];/,
  );
  assert.match(
    await read("build-tools/tools/dev/update-command/run.ts"),
    /validateUpdateTransactionTools[\s\S]*ensureNixStoreToolPathSync\("gomod2nix", env\)/,
  );
  assert.match(
    await read("build-tools/tools/nix/devshell.nix"),
    /buildInputs = \[[\s\S]*pkgs\.viberootsRustToolchain/,
  );
});

test("launcher fixture exports the single canonical shared pnpm hash-cache authority", async () => {
  const source = await read("build-tools/tools/tests/dev/update-command-launcher.fixture.ts");
  assert.match(
    source,
    /import \{ sharedPnpmStoreHashCacheRoot \} from "\.\.\/\.\.\/dev\/update-pnpm-hash\/verified-marker";/,
    "launcher fixture must import the canonical shared-hash-cache helper",
  );
  assert.match(
    source,
    /sharedPnpmStoreHashCacheRoot\(process\.env, os\.homedir\(\)\)/,
    "launcher fixture must derive the shared cache authority from the real process env + home",
  );
  assert.match(
    source,
    /VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT:[\s\S]*sharedHashCacheRoot/,
    "launcher must export VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT into the temp consumer env so " +
      "temp `u` subprocesses reuse the shared hash-cache authority instead of a fixture-local root",
  );
  assert.doesNotMatch(
    source,
    /VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT:\s*(?:""|undefined|null)/,
    "launcher must never blank the shared cache authority",
  );
});

test("read-only entrypoints invoke one shared language registry", async () => {
  assert.match(
    await read("build-tools/tools/dev/viberoots.ts"),
    /if \(shellEntry && process\.env\.VBR_DEVSHELL_RECONCILE !== "1"\)[\s\S]*runReadOnlyLanguageConsistencyCheck\(workspaceRoot, "rust"\)/,
  );
  assert.match(
    await read("build-tools/tools/lib/consumer-bootstrap.ts"),
    /if \(isPostCloneBootstrap\(opts\)\)[\s\S]*runPostCloneConsistency/,
  );
  assert.match(
    await read("build-tools/tools/dev/dev-build/run-dev-build.ts"),
    /runReadOnlyLanguageConsistencyChecks\(root\)/,
  );
});
