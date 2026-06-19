#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("run-runnable exposes timeout diagnostics toggles", async () => {
  const file = "viberoots/build-tools/tools/dev/run-runnable-nix.ts";
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("VBR_RUNNABLE_TIMEOUT_DIAG")) {
    throw new Error(`${file} must expose VBR_RUNNABLE_TIMEOUT_DIAG toggle`);
  }
  if (!txt.includes("run-runnable-timeout-")) {
    throw new Error(`${file} must emit timeout diagnostics artifact path`);
  }
  if (!txt.includes("timeout diagnostics:")) {
    throw new Error(`${file} must log timeout diagnostics location`);
  }
});
