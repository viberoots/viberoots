#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status";

test("verify-log-status uses build-tools/tools/lib/cli.ts helpers (no bespoke process.argv parsing)", async () => {
  const txt = await fsp.readFile("viberoots/build-tools/tools/dev/verify-log-status.ts", "utf8");
  assert.ok(
    !txt.includes("process.argv"),
    "expected verify-log-status to avoid process.argv usage",
  );
});

test("verify-log-status ignores failure diagnostics process snippets", () => {
  const status = computeVerifyStatusFromLogText({
    logPath: "verify.log",
    text: [
      "[verify] begin iso=v-test start_s=1782864000",
      "[2026-06-30T18:00:00.000-07:00] ✓ Pass: root//viberoots:passing_test (1.0s)",
      "[2026-06-30T18:00:01.000-07:00] ✗ Fail: root//viberoots:real_failure (1.0s)",
      "[verify] failure diagnostics buck 1234 sed -n '/✓ Pass:/p; /✗ Fail:/p' | tail -12",
      "Tests finished: Pass 1. Fail 1. Timeout 0. Fatal 0. Skip 0. Omit 0. Infra Failure 0. Build failure 0",
    ].join("\n"),
  });

  assert.equal(status.fail, 1);
  assert.deepEqual(status.failed, ["root//viberoots:real_failure"]);
});
