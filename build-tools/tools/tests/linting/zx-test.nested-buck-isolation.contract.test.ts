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
  assert.match(
    txt,
    /--isolation-dir=\*\).*has_isolation=1/,
    "expected the nested buck2 shim to preserve explicit caller-owned isolations",
  );
  assert.match(
    txt,
    /set -- --isolation-dir \\\"\$BUCK_NESTED_ISO\\\" \\\"\$@\\\"/,
    "expected bare nested buck2 commands to use the registered test isolation",
  );
  assert.match(
    txt,
    /nested isolation is missing/,
    "expected bare nested buck2 commands to fail closed without registered isolation",
  );
  assert.match(
    txt,
    /TEST_LOG_DIR=.*buck-out\/test-logs/,
    "expected zx_test to write test logs under the stable buck-out/test-logs path",
  );
  assert.match(
    txt,
    /TEST_LOG_DIR\/\.metadata_never_index/,
    "expected zx_test to mark test log directories as excluded from macOS metadata indexing",
  );
  assert.match(
    txt,
    /TMPDIR\/\.metadata_never_index/,
    "expected zx_test to mark its temp directory as excluded from macOS metadata indexing",
  );
  assert.match(
    txt,
    /\.viberoots\/\.metadata_never_index/,
    "expected zx_test fallback workspace setup to exclude .viberoots from macOS metadata indexing",
  );
  assert.match(
    txt,
    /NODE_V8_COVERAGE\/\.metadata_never_index/,
    "expected zx_test coverage output directory to be excluded from macOS metadata indexing",
  );
  assert.match(
    txt,
    /buck-out\/zx_shims\/\.metadata_never_index/,
    "expected zx_test to mark shim directories as excluded from macOS metadata indexing",
  );
  assert.match(
    txt,
    /SHIMROOT=\\"\$\{SHIMROOT\}\.noindex\\"/,
    "expected Darwin zx_test shim roots to use a physical .noindex directory",
  );
  assert.doesNotMatch(
    txt,
    /then : > \\"[^"\n]*\.metadata_never_index\\"/,
    "expected zx_test metadata markers to be create-only so repeated tests do not churn fsevents",
  );
  assert.match(
    txt,
    /\[ ! -e \\"[^"\n]*\.metadata_never_index\\" \] && : > \\"[^"\n]*\.metadata_never_index\\"/,
    "expected zx_test metadata marker writes to guard existing marker files",
  );
});
