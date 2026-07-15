#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function source(rel: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(rel), "utf8");
}

test("cold post-clone materializes only the committed exact pnpm store", async () => {
  const [bootstrap, install, updater, store, devshell] = await Promise.all([
    source("build-tools/tools/lib/consumer-bootstrap.ts"),
    source("build-tools/tools/dev/install/deps-main.ts"),
    source("build-tools/tools/dev/update-pnpm-hash.ts"),
    source("build-tools/tools/nix/node-modules/store.nix"),
    source("build-tools/tools/lib/consumer-direnv.ts"),
  ]);

  assert.match(bootstrap, /\["exec", workspaceRoot, "i"\]/);
  assert.match(install, /refreshPnpmHashes \? \[\] : \["--read-only"\]/);
  const readOnlyBranch =
    updater.match(/if \(readOnly\) \{\n    if \(!currentHash[\s\S]*?\n    return;\n  \}/)?.[0] ||
    "";
  assert.match(readOnlyBranch, /inspectForRebuild\(\)/);
  assert.match(readOnlyBranch, /NIX_PNPM_MATERIALIZE: "1"/);
  assert.match(readOnlyBranch, /writeVerifiedMarker/);
  assert.doesNotMatch(
    readOnlyBranch,
    /NIX_PNPM_RECONCILE|updateNodeModulesHashesJson|reconcileFixedPnpmStore/,
  );
  assert.match(store, /reconcileAllowed \|\| materializeAllowed[\s\S]*populate_pnpm_store/);
  assert.doesNotMatch(devshell, /NIX_PNPM_MATERIALIZE/);
});

test("cold flake-mode post-clone reaches the same read-only materialization path", async () => {
  const [bootstrapScript, consumerBootstrap, updater, devshell] = await Promise.all([
    source("bootstrap"),
    source("build-tools/tools/lib/consumer-bootstrap.ts"),
    source("build-tools/tools/dev/update-pnpm-hash.ts"),
    source("build-tools/tools/lib/consumer-direnv.ts"),
  ]);

  assert.match(bootstrapScript, /mode="\$\(env_or_default flake VBR_CONSUMER/);
  assert.match(bootstrapScript, /printf '%s\\n%s' "flake" "default"/);
  assert.match(bootstrapScript, /if \[\[ "\$\{mode\}" == "flake" \]\]; then\n    locked_rev=/);
  assert.match(bootstrapScript, /run_nix_init_consumer_command\(\)/);
  assert.match(bootstrapScript, /init-consumer \\\n+    --mode flake/);
  assert.match(bootstrapScript, /run_install_flag="--run-install"/);
  assert.match(
    consumerBootstrap,
    /opts\.sourceMode \|\| \(opts\.sourcePath \? "submodule" : "flake"\)/,
  );
  assert.match(consumerBootstrap, /if \(opts\.runInstall\) await runInstall\(opts\.workspaceRoot/);
  assert.match(consumerBootstrap, /\["exec", workspaceRoot, "i"\]/);

  const readOnlyBranch =
    updater.match(/if \(readOnly\) \{\n    if \(!currentHash[\s\S]*?\n    return;\n  \}/)?.[0] ||
    "";
  assert.match(readOnlyBranch, /NIX_PNPM_MATERIALIZE: "1"/);
  assert.doesNotMatch(readOnlyBranch, /NIX_PNPM_RECONCILE|updateNodeModulesHashesJson/);
  assert.doesNotMatch(devshell, /NIX_PNPM_MATERIALIZE/);
});
