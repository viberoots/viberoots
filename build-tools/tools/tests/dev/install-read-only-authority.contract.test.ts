import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildToolsRoot } from "../../dev/dev-build/paths";

test("ordinary install keeps every tracked reconciliation surface behind mutation mode", async () => {
  const source = await fsp.readFile(
    path.join(buildToolsRoot(process.cwd()), "tools/dev/install/deps-main.ts"),
    "utf8",
  );
  for (const contract of [
    "runGoModTidyForMissingSum(repoRoot, dryRun, verbose, readOnlyMetadata)",
    "runGomod2nixGenerate(dryRun, verbose, readOnlyMetadata)",
    "runUvRefreshAll(dryRun, verbose, readOnlyMetadata)",
    "assertCppTrackedMetadataReady(repoRoot)",
    "if (!readOnlyMetadata) {\n  await syncModuleContractsForWebapps",
    "if (!dryRun && !readOnlyMetadata && shouldRunFinalWorkspaceLockRepair())",
  ]) {
    assert.match(source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(source, /repairGeneratedWorkspaceLock\([\s\S]*dryRun: true/);
  assert.match(source, /throw staleMetadataError\([\s\S]*workspace viberoots lock input/);
});

test("post-clone owns a tracked-clean assertion and never authorizes reconciliation", async () => {
  const bootstrap = await fsp.readFile(
    path.join(buildToolsRoot(process.cwd()), "../bootstrap"),
    "utf8",
  );
  assert.match(bootstrap, /assert_post_clone_tracked_clean/);
  assert.doesNotMatch(bootstrap, /VBR_POST_CLONE=1\s+VBR_BOOTSTRAP_PNPM_GENERATE=1/);
});
