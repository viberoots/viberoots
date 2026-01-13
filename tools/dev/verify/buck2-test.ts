import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import process from "node:process";

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
  // Default: aggressive oversubscription helps in this repo because many test actions are IO-bound
  // (Nix builds, file IO, temp repo scaffolds). Users can always override via VERIFY_BUCK2_THREADS.
  //
  // CI can set VERIFY_BUCK2_THREADS explicitly, or rely on buck2 defaults (no --num-threads) by
  // returning 0 below.
  const isCi =
    String(process.env.CI || "").trim() === "1" || String(process.env.CI || "").trim() === "true";
  if (isCi) return 0;
  const cores = Math.max(1, os.cpus()?.length || 1);
  // Historically, 30 threads has been a good local default on macOS for overall verify throughput.
  const oversubscribed = Math.ceil(cores * 3);
  return Math.max(1, Math.min(32, oversubscribed));
}

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");
}

function countPassFailFromLines(
  chunk: string,
  carry: string,
): { pass: number; fail: number; carry: string } {
  // Buck writes output in arbitrary chunk boundaries; keep a carry buffer for incomplete lines.
  const joined = carry + chunk;
  const parts = joined.split("\n");
  const complete = parts.slice(0, -1);
  const nextCarry = parts[parts.length - 1] ?? "";

  let pass = 0;
  let fail = 0;
  for (const rawLine of complete) {
    const line = stripAnsi(rawLine);
    if (/^\[[^\]]+\] ✓ Pass:/.test(line)) pass++;
    else if (/^\[[^\]]+\] ✗ Fail:/.test(line)) fail++;
  }
  return { pass, fail, carry: nextCarry };
}

export function spawnVerifyBuck2Tests(opts: {
  root: string;
  iso: string;
  logFile: string | null;
  console: "auto" | "super" | "simple";
  targets: string[];
  zxNodeModulesOut: string;
}): SpawnedVerifyTests {
  const tsecRaw = Number((process.env.VERIFY_TIMEOUT_SECS || "3600").trim());
  const tsec = Number.isFinite(tsecRaw) && tsecRaw > 0 ? Math.floor(tsecRaw) : 3600;
  const tms = tsec * 1000;

  const consoleFlag =
    opts.console === "auto"
      ? []
      : opts.console === "super"
        ? ["--console", "super"]
        : ["--console", "simple"];

  const extraEnvArgs: string[] = [];
  if (process.env.TEST_TIMING) extraEnvArgs.push("--env", `TEST_TIMING=${process.env.TEST_TIMING}`);
  if (process.env.TEST_TIMING_SUMMARY)
    extraEnvArgs.push("--env", `TEST_TIMING_SUMMARY=${process.env.TEST_TIMING_SUMMARY}`);

  const testEnvArgs: string[] = [
    "--env",
    `COVERAGE=${process.env.COVERAGE || "0"}`,
    "--env",
    `TEST_NODE_OPTIONS=--test-timeout=${tms}`,
    "--env",
    `BNX_BUCK_REAPER_STATE_FILE=${process.env.BNX_BUCK_REAPER_STATE_FILE || ""}`,
    "--env",
    `ZX_TEST_NODE_MODULES_OUT=${opts.zxNodeModulesOut}`,
    ...extraEnvArgs,
  ];
  if ((process.env.COVERAGE || "0") === "1" && process.env.NODE_V8_COVERAGE) {
    testEnvArgs.push("--env", `NODE_V8_COVERAGE=${process.env.NODE_V8_COVERAGE}`);
  }

  const threads = verifyBuck2Threads();
  const buckArgs = [
    "--isolation-dir",
    opts.iso,
    "test",
    ...consoleFlag,
    ...(threads > 0 ? ["--num-threads", String(threads)] : []),
    "--overall-timeout",
    `${tsec}s`,
    "--target-platforms",
    "prelude//platforms:default",
    ...opts.targets,
    "--",
    ...testEnvArgs,
  ];

  const startS = Math.floor(Date.now() / 1000);

  const proc = spawn("timeout", ["-k", "10s", `${tsec}s`, "buck2", ...buckArgs], {
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

  if (opts.logFile) {
    void fsp.appendFile(
      opts.logFile,
      `[verify] buck2 test begin iso=${opts.iso} start_s=${startS} threads=${threads > 0 ? threads : "default"}\n`,
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
    const r = countPassFailFromLines(s, stdoutCarry);
    stdoutCarry = r.carry;
    passCount += r.pass;
    failCount += r.fail;
    process.stdout.write(s);
    if (opts.logFile) void fsp.appendFile(opts.logFile, s, "utf8").catch(() => {});
  });
  proc.stderr?.on("data", (b) => {
    const s = String(b);
    const r = countPassFailFromLines(s, stderrCarry);
    stderrCarry = r.carry;
    passCount += r.pass;
    failCount += r.fail;
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
          `[verify] buck2 test exit iso=${opts.iso} status=${exitCode} end_s=${endS}\n`,
          "utf8",
        )
        .catch(() => {});
    }
    return exitCode ?? 1;
  };

  return { pgid, wait };
}
