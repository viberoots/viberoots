#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function source(rel: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(rel), "utf8");
}

test("post-clone explicitly materializes committed stores before read-only install", async () => {
  const [bootstrap, dispatcher, committed, install, updater, store, devshell] = await Promise.all([
    source("build-tools/tools/lib/consumer-bootstrap.ts"),
    source("build-tools/tools/dev/post-clone-pnpm-materialize.ts"),
    source("build-tools/tools/dev/update-pnpm-hash/materialize-committed.ts"),
    source("build-tools/tools/dev/install/deps-main.ts"),
    source("build-tools/tools/dev/update-pnpm-hash.ts"),
    source("build-tools/tools/nix/node-modules/store.nix"),
    source("build-tools/tools/lib/consumer-direnv.ts"),
  ]);

  assert.match(bootstrap, /\["exec", workspaceRoot, "i"\]/);
  assert.match(bootstrap, /runPostClonePnpmMaterialization/);
  assert.match(bootstrap, /opts\.runInstall && isPostCloneBootstrap\(opts\)/);
  assert.match(dispatcher, /"--materialize-committed"/);
  assert.match(dispatcher, /importer === "\." \? "pnpm-lock\.yaml" : path\.join\(importer/);
  assert.match(install, /refreshPnpmHashes \? \[\] : \["--read-only"\]/);
  const readOnlyBranch =
    updater.match(/if \(readOnly\) \{\n    if \(!currentHash[\s\S]*?\n    return;\n  \}/)?.[0] ||
    "";
  assert.match(readOnlyBranch, /inspectForRebuild\(\)/);
  assert.match(readOnlyBranch, /final pnpm store is not realized/);
  assert.match(readOnlyBranch, /writeVerifiedMarker/);
  assert.match(updater, /ensureExactStoreGcRoot/);
  assert.doesNotMatch(
    readOnlyBranch,
    /NIX_PNPM_RECONCILE|updateNodeModulesHashesJson|reconcileFixedPnpmStore/,
  );
  assert.doesNotMatch(readOnlyBranch, /NIX_PNPM_MATERIALIZE/);
  const materializeBranch =
    updater.match(/if \(materializeCommitted\) \{[\s\S]*?\n    return;\n  \}/)?.[0] || "";
  assert.match(materializeBranch, /materializeCommittedPnpmStore/);
  assert.match(committed, /NIX_PNPM_MATERIALIZE: "1"/);
  assert.match(committed, /buildStore/);
  assert.match(committed, /ensureExactStoreGcRoot/);
  assert.doesNotMatch(
    `${materializeBranch}\n${committed}`,
    /updateNodeModulesHashesJson|runPnpmStoreReconciliation|restoreHashFromSharedCache/,
  );
  assert.match(bootstrap, /VBR_POST_CLONE[\s\S]*return false/);
  assert.doesNotMatch(devshell, /NIX_PNPM_MATERIALIZE/);
});

test("cold flake-mode post-clone uses the explicit committed materialization path", async () => {
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
  assert.match(consumerBootstrap, /runPostClonePnpmMaterialization/);
  assert.match(consumerBootstrap, /\["exec", workspaceRoot, "i"\]/);

  const readOnlyBranch =
    updater.match(/if \(readOnly\) \{\n    if \(!currentHash[\s\S]*?\n    return;\n  \}/)?.[0] ||
    "";
  assert.match(readOnlyBranch, /final pnpm store is not realized/);
  assert.doesNotMatch(readOnlyBranch, /NIX_PNPM_MATERIALIZE/);
  assert.doesNotMatch(readOnlyBranch, /NIX_PNPM_RECONCILE|updateNodeModulesHashesJson/);
  assert.doesNotMatch(devshell, /NIX_PNPM_MATERIALIZE/);
});
