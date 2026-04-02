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
    /clone_rule\(\s*"sh_test"/,
    "expected zx_test to inherit the sh_test rule schema so Buck honors test_rule_timeout_ms",
  );
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
  assert.match(
    txt,
    /BNX_STREAM_NIX_BUILD_LOGS/,
    "expected zx_test to enable streamed nix build logs for long-running test diagnostics",
  );
  assert.match(
    txt,
    /\[zx_test\] timeout target=/,
    "expected zx_test to log the resolved per-target timeout budget",
  );
});
