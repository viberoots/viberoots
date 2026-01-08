#!/usr/bin/env zx-wrapper
import { runInTemp } from "./test-helpers";

// Keep the temp repo on disk so the detached reaper can locate buck-out/<iso>/forkserver.
process.env.TEST_KEEP_TMP = "1";

await runInTemp("buck-cleanup-interrupted", async (tmp, $) => {
  // Print the temp repo root so the parent test can target process scanning to this run.
  // IMPORTANT: print before we block; the parent needs this even when we are SIGKILL'd.
  console.log(`TMP ${tmp}`);
  await $`buck2 build //:flake.lock`;
  console.log("READY");
  // Block forever so the parent can SIGKILL us (simulating an interruption).
  await new Promise(() => {});
});
