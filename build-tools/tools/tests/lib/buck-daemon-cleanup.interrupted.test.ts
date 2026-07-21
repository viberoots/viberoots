#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { buckProcessTableLines } from "../../lib/process-inspection";
import { rethrowAfterAsyncCleanup, runAsyncCleanupSteps } from "./test-helpers/async-cleanup";
import {
  killBuckCleanupChild,
  observeBuckCleanupChild,
  removeInterruptedBuckCleanupRepo,
  waitForBuckCleanupChildReady,
} from "./buck-daemon-cleanup.fixture";

async function psForkserversForToken(token: string): Promise<string[]> {
  const lines = await buckProcessTableLines(2000);
  return lines.filter(
    (line) =>
      line.includes("(buck2-forkserver)") && line.includes("--state-dir") && line.includes(token),
  );
}

test("buck cleanup: interrupted temp repo run is reaped (no orphan buck2 daemons)", async () => {
  // Spawn a child that creates a temp repo and starts a buck2 daemon, then blocks.
  // We SIGKILL the child to simulate an interruption; the detached buck-daemon-reaper
  // must reap any buck2d/forkserver processes rooted under that temp repo.
  const nodeBin = process.execPath;
  const child = spawn(
    nodeBin,
    [
      "--experimental-strip-types",
      "--import",
      new URL("../../dev/zx-init.mjs", import.meta.url).pathname,
      new URL("./buck-daemon-cleanup.interrupted.child.ts", import.meta.url).pathname,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      // IMPORTANT: verify runs set VBR_BUCK_REAPER_STATE_FILE to a shared per-run reaper.
      // For this test we need a *per-child* reaper (so we can assert cleanup happens promptly
      // after SIGKILL), so explicitly disable the shared reaper for the child.
      env: {
        ...process.env,
        TEST_RSYNC_ROOTS:
          process.env.TEST_RSYNC_ROOTS ||
          "viberoots build-tools toolchains third_party/providers prelude",
        VBR_BUCK_REAPER_STATE_FILE: "",
      },
    },
  );

  const state = observeBuckCleanupChild(child);
  const cleanup = async () =>
    await runAsyncCleanupSteps([
      async () => await killBuckCleanupChild(state, { requireRunning: true }),
      async () => await removeInterruptedBuckCleanupRepo(state.tmp(), $),
    ]);

  try {
    await waitForBuckCleanupChildReady(state);

    // Ensure a forkserver exists before killing (otherwise the test is vacuous).
    const token = path.basename(state.tmp());
    {
      const lines = await psForkserversForToken(token);
      assert.ok(lines.length > 0, "expected at least one buck2-forkserver before interruption");
    }
  } catch (error) {
    console.error(`buck cleanup child stdout before owned cleanup:\n${state.stdout()}`);
    console.error(`buck cleanup child stderr before owned cleanup:\n${state.stderr()}`);
    await rethrowAfterAsyncCleanup(error, cleanup);
  }
  await cleanup();
});
