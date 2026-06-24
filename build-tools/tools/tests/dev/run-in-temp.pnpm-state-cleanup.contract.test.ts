import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("runInTemp removes temp-repo-specific pnpm state on normal cleanup", async () => {
  const helper = await fsp.readFile(
    "viberoots/build-tools/tools/tests/lib/test-helpers/run-in-temp.ts",
    "utf8",
  );

  if (!helper.includes("let tempPnpmStateRoot: string | null = null")) {
    throw new Error("runInTemp must track the temp-repo pnpm state root for cleanup");
  }
  if (!helper.includes("tempPnpmStateRoot = pnpmState.rootDir")) {
    throw new Error("runInTemp must remember externalPnpmStateDirs(tmp).rootDir");
  }
  if (!helper.includes("await removeTreeWithWritableFallback(tempPnpmStateRoot, $)")) {
    throw new Error("runInTemp must delete temp-repo-specific pnpm state during cleanup");
  }

  const keepTmpStart = helper.indexOf(
    'if (process.env.TEST_KEEP_TMP === "1")',
    helper.indexOf("tempPnpmStateRoot = pnpmState.rootDir"),
  );
  const cleanupBranchStart = helper.indexOf("} else {", keepTmpStart);
  const keepTmpBranch = helper.slice(keepTmpStart, cleanupBranchStart);
  if (keepTmpBranch.includes("tempPnpmStateRoot")) {
    throw new Error("TEST_KEEP_TMP should preserve temp-repo pnpm state for debugging");
  }
});

test("external pnpm state records exact ownership for orphan cleanup", async () => {
  const statePaths = await fsp.readFile(
    "viberoots/build-tools/tools/lib/pnpm-state-paths.ts",
    "utf8",
  );
  if (!statePaths.includes('const EXTERNAL_PNPM_STATE_META = "state.json"')) {
    throw new Error("external pnpm state must have a stable ownership metadata file");
  }
  if (!statePaths.includes("scopeAbs: normalizedScope")) {
    throw new Error("external pnpm state must record the exact scopeAbs it belongs to");
  }
  if (!statePaths.includes("export async function pruneOrphanExternalPnpmStateDirs")) {
    throw new Error("external pnpm state must expose orphan cleanup");
  }
  if (
    !statePaths.includes('entry.name === "exact"') ||
    !statePaths.includes('entry.name === "exact-index"')
  ) {
    throw new Error("orphan cleanup must not remove exact pnpm caches");
  }
  if (!statePaths.includes("pathExists(scopeAbs)")) {
    throw new Error("orphan cleanup must preserve state whose exact scopeAbs still exists");
  }

  const verifyCleanup = await fsp.readFile(
    "viberoots/build-tools/tools/dev/verify/pnpm-state.ts",
    "utf8",
  );
  if (!verifyCleanup.includes("pruneOrphanExternalPnpmStateDirs")) {
    throw new Error("verify startup cleanup must prune orphan external pnpm state");
  }
});
