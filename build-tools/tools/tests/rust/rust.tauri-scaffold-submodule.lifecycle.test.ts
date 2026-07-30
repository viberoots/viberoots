#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";
import { runTauriScaffoldLifecycle } from "./rust.tauri-scaffold-lifecycle.fixture";

process.env.TEST_NEED_DEV_ENV = "1";

test(
  "fresh submodule consumer completes the default Tauri scaffold lifecycle",
  { timeout: 1_800_000 },
  async () => {
    await runInScratchTemp("tauri-scaffold-submodule", async (tmp, $) => {
      await runTauriScaffoldLifecycle(tmp, "submodule", $);
    });
  },
);
