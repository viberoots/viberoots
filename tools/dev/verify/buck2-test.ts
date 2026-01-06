import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import process from "node:process";

export type SpawnedVerifyTests = {
  pgid: number;
  wait: () => Promise<number>;
};

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

  const buckArgs = [
    "--isolation-dir",
    opts.iso,
    "test",
    ...consoleFlag,
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

  if (opts.logFile) {
    void fsp.appendFile(
      opts.logFile,
      `[verify] buck2 test begin iso=${opts.iso} start_s=${startS}\n`,
      "utf8",
    );
  }

  proc.stdout?.on("data", (b) => {
    const s = String(b);
    process.stdout.write(s);
    if (opts.logFile) void fsp.appendFile(opts.logFile, s, "utf8").catch(() => {});
  });
  proc.stderr?.on("data", (b) => {
    const s = String(b);
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
