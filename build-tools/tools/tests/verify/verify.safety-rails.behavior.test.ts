#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  pollVerifySafetyRailsOnce,
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
