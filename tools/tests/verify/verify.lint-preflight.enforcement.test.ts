#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("verify includes a bounded lint preflight (enforcement)", async () => {
  const txt = await fsp.readFile("tools/bin/verify", "utf8");
  assert.ok(
    txt.includes("lint preflight"),
    "expected tools/bin/verify to include a lint preflight to avoid wasting time on verify when formatting/lint is dirty",
  );
  assert.ok(
    txt.includes("VERIFY_LINT_TIMEOUT_SECS"),
    "expected tools/bin/verify to bound lint preflight runtime via VERIFY_LINT_TIMEOUT_SECS",
  );
  assert.ok(
    txt.includes("timeout -k 10s"),
    "expected tools/bin/verify lint preflight to use timeout -k 10s to avoid indefinite hangs",
  );
});
