#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("probe-graph-generator-selected defaults to short timeout for fast repro", async () => {
  const file = viberootsSourcePath(
    "viberoots/build-tools/tools/dev/probe-graph-generator-selected.ts",
  );
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("VBR_RUNNABLE_BUILD_TIMEOUT_SEC")) {
    throw new Error(`${file} must set VBR_RUNNABLE_BUILD_TIMEOUT_SEC when missing`);
  }
  if (!txt.includes('process.env.VBR_RUNNABLE_BUILD_TIMEOUT_SEC = "25"')) {
    throw new Error(`${file} must default timeout to 25s for tight repro loop`);
  }
  if (!txt.includes("probe selected target")) {
    throw new Error(`${file} must label probe selected target builds`);
  }
});
