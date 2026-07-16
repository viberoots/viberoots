import * as fsp from "node:fs/promises";
import path from "node:path";
import { cleanupTempRepoProcesses } from "../../../../dev/verify/temp-repo-process-cleanup";
import {
  buckCleanupRootsForRepo,
  killBuckDaemonsForRepo,
  killBuckDaemonsForRoots,
} from "../buck-kill";
import { rewriteCoverageUrls } from "../coverage";
import { removeTreeWithWritableFallback } from "../remove-tree";
import { runAsyncCleanupSteps } from "../async-cleanup";
import { timeAsync } from "../timing";
import type { SeededTempSetup } from "./contracts";

export async function cleanupSeededTemp(args: {
  setup: SeededTempSetup;
  cleanupCommand: any;
  consumerSnapshot: { cleanup: () => Promise<void> } | null;
  tempPnpmStateRoot: string | null;
}): Promise<void> {
  const { setup, consumerSnapshot, tempPnpmStateRoot } = args;
  const { $setup, home, removeHome, tmp } = setup;
  const cleanup$ = args.cleanupCommand || $setup;
  let postRemoveBuckCleanupRoots: string[] = [];
  const steps: Array<() => Promise<void>> = [
    async () =>
      await timeAsync("temp process cleanup", async () => {
        await cleanupTempRepoProcesses({ roots: [tmp] });
      }),
    async () =>
      await timeAsync(
        "buck-daemon cleanup",
        async () => await killBuckDaemonsForRepo(tmp, cleanup$),
      ),
    async () => await consumerSnapshot?.cleanup(),
  ];
  if ((process.env.TEST_REWRITE_COVERAGE_TMP || "") === "1") {
    steps.push(async () =>
      timeAsync(`rewriteCoverageUrls(${path.basename(tmp)})`, async () => rewriteCoverageUrls(tmp)),
    );
  }
  if (process.env.TEST_KEEP_TMP === "1") {
    steps.push(async () => {
      console.error(`KEEP_TMP ${tmp}`);
      await fsp.appendFile(path.join(process.cwd(), "test-tmp-paths.log"), tmp + "\n", "utf8");
    });
  } else {
    steps.push(
      async () => {
        postRemoveBuckCleanupRoots = await buckCleanupRootsForRepo(tmp);
      },
      async () => await removeTreeWithWritableFallback(tmp, $),
      async () => {
        if (tempPnpmStateRoot) await removeTreeWithWritableFallback(tempPnpmStateRoot, $);
      },
      async () =>
        await timeAsync(
          "post-remove buck-daemon cleanup",
          async () => await killBuckDaemonsForRoots(postRemoveBuckCleanupRoots, cleanup$),
        ),
    );
  }
  if (removeHome) steps.push(async () => await removeTreeWithWritableFallback(home, $));
  await runAsyncCleanupSteps(steps);
}
