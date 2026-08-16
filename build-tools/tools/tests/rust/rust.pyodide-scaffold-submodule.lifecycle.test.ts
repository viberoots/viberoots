#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";
import { runRustPyodideScaffoldLifecycle } from "./rust.pyodide-scaffold-lifecycle.fixture";

process.env.TEST_NEED_DEV_ENV = "1";

test(
  "fresh submodule consumer completes Rust Pyodide scaffold lifecycle",
  { timeout: 1_800_000 },
  async () => {
    await runInScratchTemp("rust-pyodide-scaffold-submodule", async (tmp, $) => {
      await runRustPyodideScaffoldLifecycle(tmp, "submodule", $);
    });
  },
);
