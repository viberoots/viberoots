#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { buckProcessTableLines } from "../../lib/process-inspection";
import { rethrowAfterAsyncCleanup } from "./test-helpers/async-cleanup";
import {
  observeBuckCleanupChild,
  requestBuckCleanupChildStop,
  waitForBuckCleanupChildReady,
} from "./buck-daemon-cleanup.fixture";
import { runInTemp } from "./test-helpers";

const BUCK_CLEANUP_RSYNC_ROOTS = "viberoots build-tools toolchains third_party/providers prelude";

async function psForkserversForToken(token: string): Promise<string[]> {
  const lines = await buckProcessTableLines(2000);
  return lines.filter(
    (line) =>
      line.includes("(buck2-forkserver)") && line.includes("--state-dir") && line.includes(token),
  );
}

async function waitForPresent(token: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const lines = await psForkserversForToken(token);
    if (lines.length > 0) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`expected buck2-forkserver to appear for token=${token}`);
}

test("buck cleanup: does not kill buck2 daemons belonging to other running temp repos", async () => {
  // Start a long-running child temp repo that keeps a buck2 daemon alive.
  const nodeBin = process.execPath;
  const child = spawn(
    nodeBin,
    [
      "--experimental-strip-types",
      "--import",
      new URL("../../dev/zx-init.mjs", import.meta.url).pathname,
      new URL("./buck-daemon-cleanup.non-disruptive.child.ts", import.meta.url).pathname,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        TEST_RSYNC_ROOTS: process.env.TEST_RSYNC_ROOTS || BUCK_CLEANUP_RSYNC_ROOTS,
        VBR_BUCK_REAPER_STATE_FILE: "",
      },
    },
  );

  const state = observeBuckCleanupChild(child);
  const cleanup = async () => await requestBuckCleanupChildStop(state);

  try {
    await waitForBuckCleanupChildReady(state);
    const tmp = state.tmp();

    const token = path.basename(tmp);
    await waitForPresent(token, 10_000);

    const originalRsyncRoots = process.env.TEST_RSYNC_ROOTS;
    try {
      process.env.TEST_RSYNC_ROOTS = originalRsyncRoots || BUCK_CLEANUP_RSYNC_ROOTS;
      // Run an unrelated temp-repo test. Its cleanup must not kill the child's forkserver,
      // because the child's repo still exists and is not under the other temp root.
      await runInTemp("buck-cleanup-nondisruptive-other", async (_tmp2, $) => {
        await $`buck2 build //.viberoots/workspace:flake.lock`;
      });
    } finally {
      if (originalRsyncRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
      else process.env.TEST_RSYNC_ROOTS = originalRsyncRoots;
    }

    // Signal the child to run another buck2 build while it is still running.
    await fsp.writeFile(path.join(tmp, "go.signal"), "go\n", "utf8");

    const t1 = Date.now();
    while (!state.stdout().includes("PING_OK") && Date.now() - t1 < 60_000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(
      state.stdout().includes("PING_OK"),
      `expected child to complete second build; stdout:\n${state.stdout()}`,
    );
  } catch (error) {
    console.error(`buck cleanup child stdout before owned cleanup:\n${state.stdout()}`);
    console.error(`buck cleanup child stderr before owned cleanup:\n${state.stderr()}`);
    await rethrowAfterAsyncCleanup(error, cleanup);
  }
  await cleanup();
});
