#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  captureBuck2DebugArtifacts,
  shouldCaptureBuck2DebugArtifacts,
} from "../../dev/verify/buck2-artifacts";
import {
  countIsolationMatches,
  summarizeVerifyProcessSnapshot,
} from "../../dev/verify/buck2-failure-diagnostics";
import { verifyBuck2Threads } from "../../dev/verify/buck2-test";

test("verify buck2 thread defaults honor explicit override", () => {
  assert.equal(
    verifyBuck2Threads({
      env: { VERIFY_BUCK2_THREADS: "17" },
      cpuCount: 64,
      targetCount: 1000,
    }),
    17,
  );
});

test("verify buck2 artifact capture preserves command reports outside buck-out", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-buck2-artifacts-"));
  const iso = "v-123-1700000000000";
  const report = path.join(tmp, "buck-out", iso, "log", "trace-1", "command_report.json");
  await fsp.mkdir(path.dirname(report), { recursive: true });
  await fsp.writeFile(report, JSON.stringify({ trace_id: "trace-1", exit_code: 2 }), "utf8");

  const analysisDir = path.join(tmp, "analysis");
  await captureBuck2DebugArtifacts({
    root: tmp,
    analysisDir,
    logFile: null,
    passName: "shared",
    parentIso: iso,
    nestedIso: "verify-nested-123-deadbeef",
    status: 2,
    exitCode: 2,
    exitSignal: null,
    closeCode: 2,
    closeSignal: null,
    buckArgs: ["buck2", "--isolation-dir", iso, "test", "//..."],
    stdoutTail: "stdout tail",
    stderrTail: "stderr tail",
  });

  const captureRoot = path.join(analysisDir, "buck2-artifacts", "shared");
  const copied = await fsp.readFile(
    path.join(captureRoot, iso, "log", "trace-1", "command_report.json"),
    "utf8",
  );
  const manifest = JSON.parse(await fsp.readFile(path.join(captureRoot, "manifest.json"), "utf8"));
  assert.match(copied, /trace-1/);
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.files[0].copied, true);
  assert.match(await fsp.readFile(path.join(captureRoot, "stderr-tail.txt"), "utf8"), /stderr/);
});

test("verify buck2 artifact capture skips normal test failures unless abnormal", () => {
  assert.equal(
    shouldCaptureBuck2DebugArtifacts({ status: 32, stderrTail: "test failed", env: {} }),
    false,
  );
  assert.equal(
    shouldCaptureBuck2DebugArtifacts({
      status: 32,
      stderrTail: "Buck daemon event bus: broken pipe",
      env: {},
    }),
    true,
  );
  assert.equal(shouldCaptureBuck2DebugArtifacts({ status: 2, stderrTail: "", env: {} }), true);
});

test("verify buck2 thread defaults leave CI on buck2 defaults", () => {
  assert.equal(
    verifyBuck2Threads({
      env: { CI: "true" },
      cpuCount: 64,
      targetCount: 1000,
    }),
    0,
  );
});

test("verify buck2 thread defaults cap large local target sets", () => {
  assert.equal(
    verifyBuck2Threads({
      env: {},
      cpuCount: 64,
      targetCount: 1200,
    }),
    8,
  );
});

test("verify buck2 thread defaults keep small local target sets responsive", () => {
  assert.equal(
    verifyBuck2Threads({
      env: {},
      cpuCount: 64,
      targetCount: 8,
    }),
    20,
  );
});

test("verify failure diagnostics summarize process snapshots", () => {
  const summary = summarizeVerifyProcessSnapshot([
    "101 1 00:01:00 /nix/store/node/bin/node viberoots/build-tools/tools/tests/foo.test.ts",
    "102 1 00:02:00 buck2d[verify-nested-123-abcdefabcdef] --isolation-dir verify-nested-123-abcdefabcdef",
    "103 1 00:03:00 /nix/store/bin/nix build .#check",
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.node, 1);
  assert.equal(summary.buck, 1);
  assert.equal(summary.nix, 1);
  assert.deepEqual(summary.buckLines, [
    "102 1 00:02:00 buck2d[verify-nested-123-abcdefabcdef] --isolation-dir verify-nested-123-abcdefabcdef",
  ]);
  assert.deepEqual(
    countIsolationMatches({
      snapshot: summary,
      parentIso: "v-123-1700000000000",
      nestedIso: "verify-nested-123-abcdefabcdef",
    }),
    { parentMatches: 0, nestedMatches: 1 },
  );
});
