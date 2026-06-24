#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  decideVerifySafetyRailsTrigger,
  makeTransientRootSampler,
  pollVerifySafetyRailsOnce,
  summarizeVerifySafetyRailsTelemetry,
  writeVerifySafetyRailsTriggerSnapshot,
} from "../../dev/verify/safety-rails";

async function readText(p: string): Promise<string> {
  return await fsp.readFile(p, "utf8");
}

test("verify safety rails: triggers write snapshot and signal only the intended process group", async () => {
  const analysisDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-safety-rails-"));
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
    lowSpaceGiB: 5,
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
});

test("verify safety rails: free-space drops are telemetry only", async () => {
  const analysisDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-safety-rails-drop-"));
  const telemetryPath = path.join(analysisDir, "telemetry.log");
  await fsp.writeFile(telemetryPath, "", "utf8");

  const signals: Array<{ pgid: number; signal: NodeJS.Signals }> = [];
  const timers: number[] = [];
  const pgid = 4242;
  signals.length = 0;
  timers.length = 0;
  const decision = await pollVerifySafetyRailsOnce({
    analysisDir,
    processGroupIdToKill: pgid,
    lowSpaceGiB: 0,
    telemetryPath,
    deps: {
      freeGiBForPath: async (_p: string) => 20,
      activeNixGcProcesses: async () => [],
      onTrigger: async (_reason: string) => {},
      writeSnapshot: async () => {},
      killProcessGroup: (pgid: number, signal: NodeJS.Signals) => {
        signals.push({ pgid, signal });
      },
      setTimeoutFn: (fn: () => void, ms: number) => {
        timers.push(ms);
        fn();
      },
    },
  });
  assert.equal(decision, null);
  assert.deepEqual(signals, []);
  assert.deepEqual(timers, []);
  const telemetry = await readText(telemetryPath);
  assert.match(telemetry, /freeGiB=20/);
});

test("verify safety rails: transient-root sampler uses long healthy spacing", () => {
  let now = 1_000_000;
  const shouldSample = makeTransientRootSampler({
    transientRoot: "/tmp/viberoots-verify-user.noindex/tmpdir",
    sampleSec: 1800,
    nearThresholdSampleSec: 120,
    marginGiB: 20,
    nowMs: () => now,
  });

  assert.equal(shouldSample(200, 5), true);
  now += 299 * 1000;
  assert.equal(shouldSample(200, 5), false);
  now += 1501 * 1000;
  assert.equal(shouldSample(200, 5), true);
});

test("verify safety rails: transient-root sampler throttles near-threshold checks", () => {
  let now = 1_000_000;
  const shouldSample = makeTransientRootSampler({
    transientRoot: "/tmp/viberoots-verify-user.noindex/tmpdir",
    sampleSec: 1800,
    nearThresholdSampleSec: 120,
    marginGiB: 20,
    nowMs: () => now,
  });

  assert.equal(shouldSample(24, 5), true);
  now += 30 * 1000;
  assert.equal(shouldSample(24, 5), false);
  now += 90 * 1000;
  assert.equal(shouldSample(24, 5), true);
});

test("verify safety rails: transient-root size walk is optional per poll", async () => {
  const analysisDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-safety-rails-du-skip-"));
  const telemetryPath = path.join(analysisDir, "telemetry.log");
  await fsp.writeFile(telemetryPath, "", "utf8");
  let transientCalls = 0;

  const decision = await pollVerifySafetyRailsOnce({
    analysisDir,
    processGroupIdToKill: 4242,
    transientRoot: path.join(analysisDir, "tmpdir"),
    lowSpaceGiB: 5,
    telemetryPath,
    deps: {
      freeGiBForPath: async (_p: string) => 200,
      transientGiBForPath: async (_p: string) => {
        transientCalls++;
        return 12;
      },
      shouldSampleTransientRoot: () => false,
      activeNixGcProcesses: async () => [],
      onTrigger: async (_reason: string) => {},
      writeSnapshot: async () => {},
      killProcessGroup: () => {},
      setTimeoutFn: () => {},
    },
  });

  assert.equal(decision, null);
  assert.equal(transientCalls, 0);
  const telemetry = await readText(telemetryPath);
  assert.match(telemetry, /freeGiB=200/);
  assert.match(telemetry, /transientGiB=0/);
});

test("verify safety rails: transient-root size walk still runs when requested", async () => {
  const analysisDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-safety-rails-du-sample-"));
  const telemetryPath = path.join(analysisDir, "telemetry.log");
  await fsp.writeFile(telemetryPath, "", "utf8");
  let transientCalls = 0;

  const decision = await pollVerifySafetyRailsOnce({
    analysisDir,
    processGroupIdToKill: 4242,
    transientRoot: path.join(analysisDir, "tmpdir"),
    lowSpaceGiB: 5,
    telemetryPath,
    deps: {
      freeGiBForPath: async (_p: string) => 24,
      transientGiBForPath: async (_p: string) => {
        transientCalls++;
        return 12;
      },
      shouldSampleTransientRoot: (curFreeGiB, lowSpaceGiB) => curFreeGiB <= lowSpaceGiB + 20,
      activeNixGcProcesses: async () => [],
      onTrigger: async (_reason: string) => {},
      writeSnapshot: async () => {},
      killProcessGroup: () => {},
      setTimeoutFn: () => {},
    },
  });

  assert.equal(decision, null);
  assert.equal(transientCalls, 1);
  const telemetry = await readText(telemetryPath);
  assert.match(telemetry, /freeGiB=24/);
  assert.match(telemetry, /transientGiB=12/);
  assert.match(telemetry, /reclaimableFreeGiB=36/);
});

test("verify safety rails: free-space drop alone does not stop verify", async () => {
  assert.equal(
    decideVerifySafetyRailsTrigger({
      curFreeGiB: 58,
      lowSpaceGiB: 5,
    }),
    null,
  );
});

test("verify safety rails: low-space guard still uses raw free space", () => {
  const decision = decideVerifySafetyRailsTrigger({
    curFreeGiB: 4,
    lowSpaceGiB: 5,
  });
  assert.ok(decision, "expected raw low free space to trigger");
  assert.match(decision.reason, /VERIFY_LOW_SPACE_GB/);
});

test("verify safety rails: active nix gc is logged as notice and does not stop verify", async () => {
  const analysisDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-safety-rails-gc-"));
  const telemetryPath = path.join(analysisDir, "telemetry.log");
  await fsp.writeFile(telemetryPath, "", "utf8");

  const signals: Array<{ pgid: number; signal: NodeJS.Signals }> = [];
  const notes: string[] = [];

  const decision = await pollVerifySafetyRailsOnce({
    analysisDir,
    processGroupIdToKill: 31337,
    lowSpaceGiB: 0,
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

test("verify safety rails: high-load telemetry includes bounded top-process sample", async () => {
  const analysisDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-safety-rails-top-proc-"));
  const telemetryPath = path.join(analysisDir, "telemetry.log");
  await fsp.writeFile(telemetryPath, "", "utf8");

  const decision = await pollVerifySafetyRailsOnce({
    analysisDir,
    processGroupIdToKill: 4242,
    lowSpaceGiB: 0,
    highLoadTopProcessesThreshold: 0,
    telemetryPath,
    deps: {
      freeGiBForPath: async (_p: string) => 45,
      activeNixGcProcesses: async () => [],
      onTrigger: async (_reason: string) => {},
      writeSnapshot: async () => {},
      killProcessGroup: () => {},
      setTimeoutFn: () => {},
      sampleTopProcesses: async () => ({
        lines: ["pid=100 ppid=1 stat=R pcpu=88.0 pmem=0.1 cmd=mds_stores"],
      }),
    },
  });

  assert.equal(decision, null);
  const telemetry = await readText(telemetryPath);
  assert.match(
    telemetry,
    /\[verify\] high-load top-process load1=[0-9.]+ pid=100 .*cmd=mds_stores/,
  );
});

test("verify safety rails: telemetry summary captures load and process-count peaks", async () => {
  const analysisDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-safety-rails-summary-"));
  const telemetryPath = path.join(analysisDir, "telemetry.log");
  await fsp.writeFile(
    telemetryPath,
    [
      "[verify] safety-rails baseline /nix/store free ~100GiB",
      "111 freeGiB=99 load1=10.25 load5=8.00 load15=7.00 processes=200 node=80 buck=5 nix=2 verify_env=60",
      "222 freeGiB=98 load1=12.50 load5=9.25 load15=7.50 processes=250 node=90 buck=7 nix=4 verify_env=70",
      "[verify] high-load top-process load1=88.00 pid=100 ppid=1 stat=R pcpu=90.0 pmem=0.1 cmd=mds_stores",
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
  assert.equal(summary.highLoadTopProcessSamples, 1);
  assert.deepEqual(summary.highLoadTopProcessLines, [
    "high-load top-process load1=88.00 pid=100 ppid=1 stat=R pcpu=90.0 pmem=0.1 cmd=mds_stores",
  ]);
});
