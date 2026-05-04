#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDiskUsageFromDfOutput } from "../../dev/tail-log/status-helpers";

test("tail-log status helpers: parses portable df -kP output", () => {
  const out = [
    "Filesystem 1024-blocks Used Available Capacity Mounted on",
    "/dev/root 488245288 437207652 26137780 95% /",
  ].join("\n");

  assert.equal(formatDiskUsageFromDfOutput(out), "25GiB free, 466GiB total, 95% full");
});

test("tail-log status helpers: returns null for unparseable df output", () => {
  assert.equal(formatDiskUsageFromDfOutput("Filesystem nonsense"), null);
});
