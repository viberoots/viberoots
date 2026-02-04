#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("verify-log-status: --json emits exactly one NDJSON line", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-log-status-ndjson-"));
  const logPath = path.join(tmp, "verify.log");
  await fsp.writeFile(logPath, "[verify] buck2 test begin iso=v-1 start_s=100\n", "utf8");

  const res =
    await $`${process.cwd()}/build-tools/tools/dev/verify-log-status.ts --log ${logPath} --pid 1 --json`.nothrow();
  assert.equal(res.exitCode, 0);
  const lines = res.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1);
  const obj = JSON.parse(lines[0]);
  assert.equal(obj.pid, 1);
  assert.ok(Object.prototype.hasOwnProperty.call(obj, "pass"));
  assert.ok(Object.prototype.hasOwnProperty.call(obj, "log"));
});
