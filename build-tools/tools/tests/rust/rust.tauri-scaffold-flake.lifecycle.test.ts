#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";
import { runTauriScaffoldLifecycle } from "./rust.tauri-scaffold-lifecycle.fixture";

process.env.TEST_NEED_DEV_ENV = "1";

test(
  "fresh flake-input consumer completes the default Tauri scaffold lifecycle",
  { timeout: 1_800_000 },
  async () => {
    await runInScratchTemp("tauri-scaffold-flake", async (tmp, $) => {
      await runTauriScaffoldLifecycle(tmp, "flake", $);
    });
  },
);
