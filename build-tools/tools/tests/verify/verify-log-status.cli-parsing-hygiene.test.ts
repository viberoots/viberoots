#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("verify-log-status uses build-tools/tools/lib/cli.ts helpers (no bespoke process.argv parsing)", async () => {
  const txt = await fsp.readFile("build-tools/tools/dev/verify-log-status.ts", "utf8");
  assert.ok(
    !txt.includes("process.argv"),
    "expected verify-log-status to avoid process.argv usage",
  );
});
