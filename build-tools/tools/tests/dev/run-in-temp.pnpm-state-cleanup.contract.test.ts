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
