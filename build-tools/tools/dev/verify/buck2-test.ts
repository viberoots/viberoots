import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import process from "node:process";
import { type Buck2Completion, parseBuck2ProgressFromLines } from "./buck2-output";
import { buildVerifyTestEnvArgs } from "./buck2-test-env.ts";
import { resolveToolPathSync } from "../../lib/tool-paths.ts";

export type SpawnedVerifyTests = {
  pgid: number;
  wait: () => Promise<number>;
};

function verifyBuck2Threads(): number {
  const raw = String(process.env.VERIFY_BUCK2_THREADS || "").trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  // Default: keep concurrency moderate to avoid temp-repo seed copy storms and buck daemon churn.
  // Users can override via VERIFY_BUCK2_THREADS.
  //
  // CI can set VERIFY_BUCK2_THREADS explicitly, or rely on buck2 defaults (no --num-threads)
  // by returning 0 below.
  const isCi =
    String(process.env.CI || "").trim() === "1" || String(process.env.CI || "").trim() === "true";
  if (isCi) return 0;
  const cores = Math.max(1, os.cpus()?.length || 1);
  // Empirical default: ~2x cores with a tighter cap is more stable for local verify workloads
  // that run many runInTemp-based tests concurrently.
  const moderate = Math.ceil(cores * 2);
  return Math.max(1, Math.min(20, moderate));
}

export function spawnVerifyBuck2Tests(opts: {
  root: string;
  iso: string;
  logFile: string | null;
  console: "auto" | "super" | "simple";
  targets: string[];
  zxNodeModulesOut: string;
  threadsOverride?: number;
  passName?: string;
}): SpawnedVerifyTests {
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
  const overallTimeoutSecs = Math.max(tsec, testNixTimeoutSecs + 5 * 60);
  // Node's per-test timeout should never be tighter than the Nix timeout budget.
  const nodeTestTimeoutMs = Math.max(minPerTestTimeoutSecs * 1000, tms, testNixTimeoutSecs * 1000);

  const consoleFlag =
    opts.console === "auto"
      ? []
      : opts.console === "super"
        ? ["--console", "super"]
        : ["--console", "simple"];

  const threads = opts.threadsOverride ?? verifyBuck2Threads();
  const passName = String(opts.passName || "shared");
  const testEnvArgs = buildVerifyTestEnvArgs({
    iso: opts.iso,
    passName,
    zxNodeModulesOut: opts.zxNodeModulesOut,
    nodeTestTimeoutMs,
    testNixTimeoutSecs,
  });
  const buckArgs = [
    "--isolation-dir",
    opts.iso,
    "test",
    ...consoleFlag,
    ...(threads > 0 ? ["--num-threads", String(threads)] : []),
    "--overall-timeout",
    `${overallTimeoutSecs}s`,
    "--target-platforms",
    "prelude//platforms:default",
    ...opts.targets,
    "--",
    ...testEnvArgs,
  ];

  const startS = Math.floor(Date.now() / 1000);
  const timeoutPath = resolveToolPathSync("timeout");
  const buck2Path = resolveToolPathSync("buck2");

  const proc = spawn(timeoutPath, ["-k", "10s", `${overallTimeoutSecs}s`, buck2Path, ...buckArgs], {
    cwd: opts.root,
    env: {
      ...process.env,
      RUST_LOG:
        (process.env.RUST_LOG || "warn") +
        ",buck2_client_ctx::file_tailers::tailer=off,buck2_event_log::writer=off",
      BUCK_LOG:
        (process.env.BUCK_LOG || "warn") +
        ",buck2_client_ctx::file_tailers::tailer=off,buck2_event_log::writer=off",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pgid = proc.pid || process.pid;

  // Keep incremental pass/fail counts without rereading the full verify log (which can be huge).
  // This makes pacing checkpoints O(1) and avoids slowdowns late in long verify runs.
  let passCount = 0;
  let failCount = 0;
  let stdoutCarry = "";
  let stderrCarry = "";
  const slowest: Buck2Completion[] = [];
  const SLOWEST_MAX = 25;

  const recordCompletion = (c: Buck2Completion) => {
    // Keep only the slowest N completions. N is small so O(N) insert is fine.
    slowest.push(c);
    slowest.sort((a, b) => b.durationSec - a.durationSec);
    if (slowest.length > SLOWEST_MAX) slowest.length = SLOWEST_MAX;
  };

  if (opts.logFile) {
    void fsp.appendFile(
      opts.logFile,
      `[verify] buck2 test begin iso=${opts.iso} pass=${passName} start_s=${startS} threads=${threads > 0 ? threads : "default"}\n`,
      "utf8",
    );
  }

  const schedulePacingCheckpoint = (afterMs: number) => {
    if (!opts.logFile) return;
    setTimeout(() => {
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
  };
  // Validate early throughput (helps spot too-low or too-high thread caps).
  schedulePacingCheckpoint(5 * 60 * 1000);
  schedulePacingCheckpoint(10 * 60 * 1000);

  proc.stdout?.on("data", (b) => {
    const s = String(b);
    const r = parseBuck2ProgressFromLines(s, stdoutCarry);
    stdoutCarry = r.carry;
    passCount += r.pass;
    failCount += r.fail;
    for (const c of r.completions) recordCompletion(c);
    process.stdout.write(s);
    if (opts.logFile) void fsp.appendFile(opts.logFile, s, "utf8").catch(() => {});
  });
  proc.stderr?.on("data", (b) => {
    const s = String(b);
    const r = parseBuck2ProgressFromLines(s, stderrCarry);
    stderrCarry = r.carry;
    passCount += r.pass;
    failCount += r.fail;
    for (const c of r.completions) recordCompletion(c);
    process.stderr.write(s);
    if (opts.logFile) void fsp.appendFile(opts.logFile, s, "utf8").catch(() => {});
  });

  const wait = async (): Promise<number> => {
    const exitCode: number = await new Promise((resolve) => {
      proc.on("exit", (code) => resolve(typeof code === "number" ? code : 1));
    });
    const endS = Math.floor(Date.now() / 1000);
    if (opts.logFile) {
      await fsp
        .appendFile(
          opts.logFile,
          `[verify] buck2 test exit iso=${opts.iso} pass=${passName} status=${exitCode} end_s=${endS}\n`,
          "utf8",
        )
        .catch(() => {});
    }
    if (opts.logFile && slowest.length > 0) {
      const header = `[verify] slowest targets pass=${passName} (top ${Math.min(SLOWEST_MAX, slowest.length)}):`;
      const lines = slowest.map((c) => {
        const secs = c.durationSec.toFixed(1);
        return `[verify] slow ${secs}s ${c.status} ${c.target} (${c.rawDuration})`;
      });
      try {
        process.stderr.write(header + "\n");
        for (const l of lines) process.stderr.write(l + "\n");
      } catch {}
      await fsp.appendFile(opts.logFile, [header, ...lines, ""].join("\n"), "utf8").catch(() => {});
    }
    return exitCode ?? 1;
  };

  return { pgid, wait };
}
