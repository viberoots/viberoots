import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function readRepoFile(relativePath: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(relativePath), "utf8");
}

test("runInTemp removes temp-repo-specific pnpm state on normal cleanup", async () => {
  const helper = await readRepoFile("build-tools/tools/tests/lib/test-helpers/run-in-temp.ts");

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
  const statePaths = await readRepoFile("build-tools/tools/lib/pnpm-state-paths.ts");
  if (!statePaths.includes('const EXTERNAL_PNPM_STATE_META = "state.json"')) {
    throw new Error("external pnpm state must have a stable ownership metadata file");
  }
  if (!statePaths.includes("scopeAbs: normalizedScope")) {
    throw new Error("external pnpm state must record the exact scopeAbs it belongs to");
  }
  if (!statePaths.includes("export async function pruneOrphanExternalPnpmStateDirs")) {
    throw new Error("external pnpm state must expose orphan cleanup");
  }
  if (!statePaths.includes("export async function removeExternalPnpmStateDir")) {
    throw new Error("external pnpm state must expose exact-scope cleanup");
  }
  if (!statePaths.includes('if (entry.name === "final-fod") continue')) {
    throw new Error("orphan cleanup must leave transient final-FOD lock state to its owner");
  }
  if (statePaths.includes("exact-index") || statePaths.includes("ready.json")) {
    throw new Error("pnpm state cleanup must not retain the retired exact-store index protocol");
  }
  if (!statePaths.includes("pathExists(scopeAbs)")) {
    throw new Error("orphan cleanup must preserve state whose exact scopeAbs still exists");
  }

  const verifyCleanup = await readRepoFile("build-tools/tools/dev/verify/pnpm-state.ts");
  if (!verifyCleanup.includes("pruneOrphanExternalPnpmStateDirs")) {
    throw new Error("verify startup cleanup must prune orphan external pnpm state");
  }
  if (!verifyCleanup.includes("removeExternalPnpmStateDir(importerAbs)")) {
    throw new Error("verify startup cleanup must remove active importer external pnpm state");
  }
});

test("runInTemp preserves managed viberoots node_modules for temp child commands", async () => {
  const helper = await readRepoFile("build-tools/tools/tests/lib/test-helpers/run-in-temp.ts");

  if (!helper.includes("function applyTempNodePath(")) {
    throw new Error("runInTemp must centralize temp child NODE_PATH construction");
  }
  const managedPathIndex = helper.indexOf("env.VIBEROOTS_NODE_PATH");
  const guessedPathIndex = helper.indexOf('path.join(process.cwd(), "node_modules")');
  if (managedPathIndex < 0) {
    throw new Error("runInTemp must include VIBEROOTS_NODE_PATH in temp child NODE_PATH");
  }
  if (guessedPathIndex < 0) {
    throw new Error("runInTemp must still include workspace node_modules in temp child NODE_PATH");
  }
  if (managedPathIndex > guessedPathIndex) {
    throw new Error("VIBEROOTS_NODE_PATH must precede guessed node_modules paths");
  }
  if (!helper.includes("process.env.VIBEROOTS_NODE_PATH")) {
    throw new Error("runInTemp must preserve inherited managed node_modules if env is overwritten");
  }
});
