#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("linting: zx_test forwards pnpm fetch timeout and wraps node --test with command heartbeat", async () => {
  const p = path.join(process.cwd(), "build-tools", "tools", "buck", "zx_test.bzl");
  const txt = await fsp.readFile(p, "utf8");
  assert.match(
    txt,
    /export NIX_PNPM_FETCH_TIMEOUT=.*TSECS/,
    "expected zx_test to align pnpm fetch timeout with the per-test budget",
  );
  assert.match(
    txt,
    /command-heartbeat\.ts/,
    "expected zx_test to wrap node --test in the heartbeat runner for long-running diagnostics",
  );
});
