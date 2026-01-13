#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { runInTemp } from "./test-helpers";

// Keep the temp repo on disk so the detached reaper can locate buck-out/<iso>/forkserver.
process.env.TEST_KEEP_TMP = "1";
// Print TMP as early as possible (before temp repo seeding), so the parent can coordinate even if
// setup is slow or the process is interrupted mid-init.
process.env.TEST_EARLY_TMP_STDOUT = "1";

await runInTemp("buck-cleanup-interrupted", async (tmp, $) => {
  // Start a buck2 build and print READY once the forkserver state dir appears.
  // The parent test will SIGKILL this process to simulate interruption while buck2 is live.
  //
  // IMPORTANT: do not rely on zx's command stdio defaults here; the parent test expects READY on
  // the child's stdout stream.
  spawn("buck2", ["build", "//:flake.lock"], {
    cwd: tmp,
    env: process.env,
    stdio: "ignore",
    detached: true,
  });
  const fsDir = path.join(tmp, "buck-out", "v2", "forkserver");
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    try {
      await fsp.access(fsDir);
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log("READY");
  // Block forever so the parent can SIGKILL us (simulating an interruption).
  await new Promise(() => {});
});
