#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  pollVerifySafetyRailsOnce,
  summarizeVerifySafetyRailsTelemetry,
  writeVerifySafetyRailsTriggerSnapshot,
} from "../../dev/verify/safety-rails.ts";

async function readText(p: string): Promise<string> {
  return await fsp.readFile(p, "utf8");
}

test("verify safety rails: triggers write snapshot and signal only the intended process group", async () => {
  const analysisDir = await fsp.mkdtemp(path.join(os.tmpdir(), "bnx-safety-rails-"));
  const telemetryPath = path.join(analysisDir, "telemetry.log");
  await fsp.writeFile(telemetryPath, "", "utf8");

  const signals: Array<{ pgid: number; signal: NodeJS.Signals }> = [];
  const timers: number[] = [];
  let nextFreeGiB = 100;

  const deps = {
    freeGiBForPath: async (_p: string) => nextFreeGiB,
    activeNixGcProcesses: async () => [],
    onTrigger: async (_reason: string) => {},
    writeSnapshot: async (dir: string, reason: string) => {
      await writeVerifySafetyRailsTriggerSnapshot(dir, reason, {
        sampleDfText: async () => "df-output\n",
      });
    },
    killProcessGroup: (pgid: number, signal: NodeJS.Signals) => {
      signals.push({ pgid, signal });
    },
    setTimeoutFn: (fn: () => void, ms: number) => {
      timers.push(ms);
      fn();
    },
  };

  const pgid = 4242;

  nextFreeGiB = 2;
  const d1 = await pollVerifySafetyRailsOnce({
    analysisDir,
    processGroupIdToKill: pgid,
    baseFreeGiB: 50,
    lowSpaceGiB: 5,
    dropBudgetGiB: 20,
    telemetryPath,
    deps,
  });
  assert.ok(d1, "expected low-space trigger to fire");
  assert.ok(d1.reason.includes("VERIFY_LOW_SPACE_GB"), "expected low-space reason text");
  assert.deepEqual(
    signals.map((s) => [s.pgid, s.signal]),
    [
      [pgid, "SIGTERM"],
      [pgid, "SIGKILL"],
    ],
  );
  assert.deepEqual(timers, [10_000]);

  const snapPath = path.join(analysisDir, "trigger-snapshot.txt");
  const snap = await readText(snapPath);
  assert.ok(snap.includes("safety-rails trigger:"), "expected snapshot header");
  assert.ok(snap.includes("df-output"), "expected injected df output in snapshot");

  signals.length = 0;
  timers.length = 0;
  nextFreeGiB = 20;
  const d2 = await pollVerifySafetyRailsOnce({
    analysisDir,
    processGroupIdToKill: pgid,
    baseFreeGiB: 50,
    lowSpaceGiB: 0,
    dropBudgetGiB: 20,
    telemetryPath,
    deps,
  });
  assert.ok(d2, "expected drop-budget trigger to fire");
  assert.ok(d2.reason.includes("VERIFY_NIX_DROP_BUDGET_GB"), "expected drop-budget reason text");
  assert.deepEqual(
    signals.map((s) => [s.pgid, s.signal]),
    [
      [pgid, "SIGTERM"],
      [pgid, "SIGKILL"],
    ],
  );
  assert.deepEqual(timers, [10_000]);
});

test("verify safety rails: active nix gc is logged as notice and does not stop verify", async () => {
  const analysisDir = await fsp.mkdtemp(path.join(os.tmpdir(), "bnx-safety-rails-gc-"));
  const telemetryPath = path.join(analysisDir, "telemetry.log");
  await fsp.writeFile(telemetryPath, "", "utf8");

  const signals: Array<{ pgid: number; signal: NodeJS.Signals }> = [];
  const notes: string[] = [];

  const decision = await pollVerifySafetyRailsOnce({
    analysisDir,
    processGroupIdToKill: 31337,
    baseFreeGiB: 50,
    lowSpaceGiB: 0,
    dropBudgetGiB: 20,
    telemetryPath,
    deps: {
      freeGiBForPath: async (_p: string) => 45,
      activeNixGcProcesses: async () => [{ pid: 999, command: "nix store gc --debug" }],
      onTrigger: async (reason: string) => {
        notes.push(reason);
      },
      writeSnapshot: async () => {},
      killProcessGroup: (pgid: number, signal: NodeJS.Signals) => {
        signals.push({ pgid, signal });
      },
      setTimeoutFn: () => {},
    },
  });

  assert.equal(decision, null);
  assert.equal(signals.length, 0);
  assert.equal(notes.length, 1);
  assert.match(notes[0] || "", /\[notice\] active nix gc process detected during verify/);
  const telemetry = await readText(telemetryPath);
  assert.match(
    telemetry,
    /\[verify\] safety-rails notice: active nix gc process detected during verify/,
  );
});

test("verify safety rails: telemetry summary captures load and process-count peaks", async () => {
  const analysisDir = await fsp.mkdtemp(path.join(os.tmpdir(), "bnx-safety-rails-summary-"));
  const telemetryPath = path.join(analysisDir, "telemetry.log");
  await fsp.writeFile(
    telemetryPath,
    [
      "[verify] safety-rails baseline /nix/store free ~100GiB",
      "111 freeGiB=99 load1=10.25 load5=8.00 load15=7.00 processes=200 node=80 buck=5 nix=2 verify_env=60",
      "222 freeGiB=98 load1=12.50 load5=9.25 load15=7.50 processes=250 node=90 buck=7 nix=4 verify_env=70",
      "",
    ].join("\n"),
    "utf8",
  );

  const summary = await summarizeVerifySafetyRailsTelemetry(telemetryPath);
  assert.equal(summary.samples, 2);
  assert.equal(summary.maxLoad1, 12.5);
  assert.equal(summary.maxLoad5, 9.25);
  assert.equal(summary.maxProcessCount, 250);
  assert.equal(summary.maxNodeCount, 90);
  assert.equal(summary.maxBuckCount, 7);
  assert.equal(summary.maxNixCount, 4);
  assert.equal(summary.maxVerifyEnvCount, 70);
});
