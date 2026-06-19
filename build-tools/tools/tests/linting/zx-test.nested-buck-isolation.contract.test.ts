#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("linting: zx_test exports a stable nested buck isolation for child buck commands", async () => {
  const p = path.join(process.cwd(), "viberoots", "build-tools", "tools", "buck", "zx_test.bzl");
  const txt = await fsp.readFile(p, "utf8");
  assert.match(
    txt,
    /BUCK_EXPORTER_REUSE_DAEMON/,
    "expected zx_test to default nested exporter calls to daemon reuse",
  );
  assert.match(
    txt,
    /BUCK_NESTED_ISO/,
    "expected zx_test to export a stable nested buck isolation for child commands",
  );
  assert.match(
    txt,
    /zxtest-shared-/,
    "expected zx_test to derive a shared nested isolation name from the workspace root",
  );
  assert.match(
    txt,
    /env -u BUCK_TEST_TARGET -u VBR_VERIFY_LOG_FILE -u VBR_VERIFY_PROCESS_STATE_FILE -u VBR_BUCK_REAPER_STATE_FILE/,
    "expected nested buck2 shim to scrub per-test verify env before starting reusable buckd",
  );
});
