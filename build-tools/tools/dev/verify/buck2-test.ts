import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import process from "node:process";
import { captureBuck2DebugArtifacts, shouldCaptureBuck2DebugArtifacts } from "./buck2-artifacts";
import { startVerifyDaemonCheckpoints } from "./buck2-daemon-checkpoints";
import { appendBuck2FailureDiagnostics } from "./buck2-failure-diagnostics";
import { parseBuck2ProgressFromLines } from "./buck2-output";
import { createBuck2SlowestRecorder } from "./buck2-slowest";
import { spawnBuck2WithTimeout } from "./buck2-spawn";
import { verifyBuck2Threads } from "./buck2-threads";
import { buildVerifyTestEnvArgs, previewVerifyNestedBuckIsolation } from "./buck2-test-env";
import { buildBuckProcessEnvForPolicy } from "./buck2-test-remote-env";
import { registerVerifyBuckTestIsolations } from "./verify-buck-isolation-registration";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { buckTestArgsForExecutionPolicy, targetPlatformArgsForPolicy } from "./remote-policy";
import type { VerifyExecutionPolicy } from "./remote-policy";
import {
  buckLogEnvForExecutionPolicy,
  remoteBuckArtifactArgs,
  remoteBuckPolicySummary,
  writeRemoteBuckMaterializationMetadata,
} from "./remote-buck-artifacts";
export { verifyBuck2Threads, type VerifyBuck2ThreadsOptions } from "./buck2-threads";
export function spawnVerifyBuck2Tests(opts: {
  root: string;
  iso: string;
  logFile: string | null;
  console: "auto" | "super" | "simple";
  targets: string[];
  zxNodeModulesOut: string | null;
  threadsOverride?: number;
  passName?: string;
  analysisDir?: string | null;
  executionPolicy: VerifyExecutionPolicy;
  exactOverallTimeoutSecs?: number;
  spawnImpl?: typeof spawn;
}): { pgid: number; nestedIso: string; wait: () => Promise<number> } {
  const minPerTestTimeoutSecs = 20 * 60;
  const tsecRaw = Number((process.env.VERIFY_TIMEOUT_SECS || "7200").trim());
  const tsec = Number.isFinite(tsecRaw) && tsecRaw > 0 ? Math.floor(tsecRaw) : 7200;
  const tms = tsec * 1000;
  const testNixTimeoutRaw = Number((process.env.TEST_NIX_TIMEOUT_SECS || "").trim());
  const requestedTestNixTimeoutSecs =
    Number.isFinite(testNixTimeoutRaw) && testNixTimeoutRaw > 0
      ? Math.floor(testNixTimeoutRaw)
      : 1800;
  const testNixTimeoutSecs = Math.max(minPerTestTimeoutSecs, requestedTestNixTimeoutSecs);
  const overallTimeoutSecs =
    opts.exactOverallTimeoutSecs ?? Math.max(tsec, testNixTimeoutSecs + 5 * 60);
  const nodeTestTimeoutMs = Math.max(minPerTestTimeoutSecs * 1000, tms, testNixTimeoutSecs * 1000);
  const consoleFlag =
    opts.console === "auto"
      ? []
      : opts.console === "super"
        ? ["--console", "super"]
        : ["--console", "simple"];

  const threads = opts.threadsOverride ?? verifyBuck2Threads({ targetCount: opts.targets.length });
  const passName = String(opts.passName || "shared");
  const nestedIso = previewVerifyNestedBuckIsolation(opts.iso, passName);
  registerVerifyBuckTestIsolations({ parentIso: opts.iso, nestedIso, repoRoot: opts.root });
  const testEnvArgs = buildVerifyTestEnvArgs({
    iso: opts.iso,
    passName,
    zxNodeModulesOut: opts.zxNodeModulesOut,
    nodeTestTimeoutMs,
    testNixTimeoutSecs,
    executionPolicy: opts.executionPolicy,
  });
  const timeoutPath = resolveToolPathSync("timeout");
  const buck2Path = resolveToolPathSync("buck2");
  const buckArgs = [
    "--isolation-dir",
    opts.iso,
    "test",
    ...buckTestArgsForExecutionPolicy(opts.executionPolicy, passName),
    ...remoteBuckArtifactArgs(opts.executionPolicy, passName),
    ...consoleFlag,
    ...(threads > 0 ? ["--num-threads", String(threads)] : []),
    "--overall-timeout",
    `${overallTimeoutSecs}s`,
    ...targetPlatformArgsForPolicy(opts.executionPolicy),
    ...opts.targets,
    "--",
    ...testEnvArgs,
  ];
  const buckCommandForDiagnostics = [buck2Path, ...buckArgs];

  const startS = Math.floor(Date.now() / 1000);
  const buckEnv = buildBuckProcessEnvForPolicy(opts.executionPolicy);
  const buckLogEnv = buckLogEnvForExecutionPolicy(opts.executionPolicy);
  writeRemoteBuckMaterializationMetadata({ policy: opts.executionPolicy, passName });

  const proc = spawnBuck2WithTimeout({
    timeoutPath,
    overallTimeoutSecs,
    buck2Path,
    buckArgs,
    root: opts.root,
    env: { ...buckEnv, ...buckLogEnv },
    spawnImpl: opts.spawnImpl,
  });
  const pgid = proc.pid || process.pid;

  let passCount = 0;
  let failCount = 0;
  let stdoutCarry = "";
  let stderrCarry = "";
  let stdoutTail = "";
  let stderrTail = "";
  let exitCodeRaw: number | null = null;
  let exitSignalRaw: NodeJS.Signals | null = null;
  const slowest = createBuck2SlowestRecorder(25);
  const appendTail = (current: string, next: string): string => {
    const max = 64 * 1024;
    const combined = current + next;
    return combined.length > max ? combined.slice(combined.length - max) : combined;
  };

  if (opts.logFile) {
    const remotePolicySummary = remoteBuckPolicySummary(opts.executionPolicy, passName);
    void fsp.appendFile(
      opts.logFile,
      `${remotePolicySummary ? `${remotePolicySummary}\n` : ""}[verify] buck2 test begin iso=${opts.iso} pass=${passName} start_s=${startS} threads=${threads > 0 ? threads : "default"} nested_iso=${nestedIso} target_count=${opts.targets.length}\n`,
      "utf8",
    );
  }

  const pacingTimers: NodeJS.Timeout[] = [];
  const schedulePacingCheckpoint = (afterMs: number) => {
    if (!opts.logFile) return;
    const timer = setTimeout(() => {
      void (async () => {
        const elapsedS = Math.max(0, Math.floor(Date.now() / 1000) - startS);
        const pass = passCount;
        const fail = failCount;
        const ppm = elapsedS > 0 ? (pass / (elapsedS / 60)).toFixed(1) : "0.0";
        const line = `[verify] pacing checkpoint elapsed_s=${elapsedS} pass=${pass} fail=${fail} pass_per_min=${ppm} threads=${threads > 0 ? threads : "default"}`;
        process.stderr.write(line + "\n");
        await fsp.appendFile(opts.logFile!, line + "\n", "utf8").catch(() => {});
      })();
    }, afterMs);
    timer.unref?.();
    pacingTimers.push(timer);
  };
  schedulePacingCheckpoint(5 * 60 * 1000);
  schedulePacingCheckpoint(10 * 60 * 1000);

  const daemonCheckpoints = startVerifyDaemonCheckpoints({
    logFile: opts.logFile,
    passName,
    startS,
    parentIso: opts.iso,
    nestedIso,
  });

  proc.stdout?.on("data", (b) => {
    const s = String(b);
    const r = parseBuck2ProgressFromLines(s, stdoutCarry);
    stdoutCarry = r.carry;
    stdoutTail = appendTail(stdoutTail, s);
    passCount += r.pass;
    failCount += r.fail;
    for (const c of r.completions) slowest.record(c);
    process.stdout.write(s);
    if (opts.logFile) void fsp.appendFile(opts.logFile, s, "utf8").catch(() => {});
  });
  proc.stderr?.on("data", (b) => {
    const s = String(b);
    const r = parseBuck2ProgressFromLines(s, stderrCarry);
    stderrCarry = r.carry;
    stderrTail = appendTail(stderrTail, s);
    passCount += r.pass;
    failCount += r.fail;
    for (const c of r.completions) slowest.record(c);
    process.stderr.write(s);
    if (opts.logFile) void fsp.appendFile(opts.logFile, s, "utf8").catch(() => {});
  });

  const wait = async (): Promise<number> => {
    const close = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        proc.on("exit", (code, signal) => {
          exitCodeRaw = typeof code === "number" ? code : null;
          exitSignalRaw = signal;
        });
        proc.on("close", (code, signal) => resolve({ code, signal }));
      },
    );
    for (const timer of pacingTimers) clearTimeout(timer);
    const exitCode = typeof close.code === "number" ? close.code : 1;
    const closeSignal = close.signal;
    if (opts.logFile) {
      await fsp
        .appendFile(
          opts.logFile,
          `[verify] buck2 process closed pass=${passName} exit_code=${exitCodeRaw ?? "null"} exit_signal=${exitSignalRaw ?? "null"} close_code=${close.code ?? "null"} close_signal=${closeSignal ?? "null"}\n`,
          "utf8",
        )
        .catch(() => {});
    }
    const endS = Math.floor(Date.now() / 1000);
    await daemonCheckpoints.stopAndWriteExit();
    const durationS = Math.max(0, endS - startS);
    const threadLabel = threads > 0 ? String(threads) : "default";
    if (opts.logFile) {
      await fsp
        .appendFile(
          opts.logFile,
          `[verify] buck2 test exit iso=${opts.iso} pass=${passName} status=${exitCode} end_s=${endS} duration_s=${durationS} pass_count=${passCount} fail_count=${failCount} completions=${slowest.count()} threads=${threadLabel}\n`,
          "utf8",
        )
        .catch(() => {});
    }
    if (exitCode !== 0) {
      if (shouldCaptureBuck2DebugArtifacts({ status: exitCode, stderrTail })) {
        await captureBuck2DebugArtifacts({
          root: opts.root,
          analysisDir: opts.analysisDir || null,
          logFile: opts.logFile,
          passName,
          parentIso: opts.iso,
          nestedIso,
          status: exitCode,
          exitCode: exitCodeRaw,
          exitSignal: exitSignalRaw,
          closeCode: close.code,
          closeSignal,
          buckArgs: buckCommandForDiagnostics,
          stdoutTail,
          stderrTail,
        });
      }
      await appendBuck2FailureDiagnostics({
        logFile: opts.logFile,
        passName,
        status: exitCode,
        parentIso: opts.iso,
        nestedIso,
        threads: threadLabel,
        passCount,
        failCount,
        completionCount: slowest.count(),
      });
    }
    await slowest.write(opts.logFile, passName);
    return exitCode ?? 1;
  };
  return { pgid, nestedIso, wait };
}
