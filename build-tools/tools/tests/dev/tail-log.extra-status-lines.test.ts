#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { getExtraStatusLines } from "../../dev/tail-log/status-helpers";

test("tail-log extra status lines include process counters", () => {
  const output = getExtraStatusLines(false);
  const lines = output.split("\n");
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^Buck processes:\s+\d+$/);
  assert.match(lines[1], /^Node processes:\s+\d+$/);
  assert.match(lines[2], /^Vite processes:\s+\d+$/);
  assert.match(lines[3], /^Next processes:\s+\d+$/);
  assert.match(lines[4], /^Disk usage:\s+/);
});
