import path from "node:path";
import { spawn } from "node:child_process";
import { resolveWatchdogShell, watchdogEnvFor } from "../lib/managed-command-watchdog";
import { commandCapture } from "./filtered-flake-command-capture";
import { withOwnedTempCleanup } from "../lib/owned-temp-cleanup";

function startParentWatchdog(opts: {
  childPgid: number;
  cwd?: string;
  env: NodeJS.ProcessEnv;
  cleanupPath?: string;
}): () => void {
  if (process.platform === "win32" || opts.childPgid <= 0) return () => {};
  const graceSec = Math.max(
    1,
    Number.parseInt(String(opts.env.FILTERED_FLAKE_COMMAND_WATCHDOG_GRACE_SEC || "10"), 10) || 10,
  );
  const script = [
    "set -u",
    'P="$1"',
    'G="$2"',
    'K="$3"',
    'D="$4"',
    'while kill -0 -- "-$G" 2>/dev/null; do',
    '  if ! kill -0 "$P" 2>/dev/null; then',
    '    kill -TERM -- "-$G" 2>/dev/null || true',
    '    sleep "$K"',
    '    kill -KILL -- "-$G" 2>/dev/null || true',
    '    if [ -n "$D" ]; then rm -rf -- "$D" 2>/dev/null || true; fi',
    "    exit 0",
    "  fi",
    "  sleep 1",
    "done",
  ].join("\n");
  const watchdog = spawn(
    resolveWatchdogShell(opts.env),
    [
      "--noprofile",
      "--norc",
      "-c",
      script,
      "filtered-flake-command-watchdog",
      String(process.pid),
      String(opts.childPgid),
      String(graceSec),
      opts.cleanupPath || "",
    ],
    {
      cwd: opts.cwd,
      env: watchdogEnvFor(opts.env),
      stdio: "ignore",
      detached: true,
    },
  );
  const watchdogPid = watchdog.pid || 0;
  watchdog.on("error", () => {});
  watchdog.unref();
  return () => {
    if (watchdogPid <= 0) return;
    try {
      process.kill(watchdogPid, "SIGTERM");
    } catch {}
  };
}

export async function runCommand(opts: {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
  timeoutMs?: number;
  killGraceMs?: number;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const capture = await commandCapture();
  let stopWatchdog = () => {};
  let removeSignalHandlers = () => {};
  return await withOwnedTempCleanup(
    async () => {
      try {
        return await new Promise((resolve, reject) => {
          const proc = spawn(opts.command, opts.args, {
            cwd: opts.cwd,
            env: opts.env || process.env,
            stdio: capture.stdio,
            detached: process.platform !== "win32",
          });
          let stdout = "";
          let stderr = "";
          let settled = false;
          let timedOut = false;
          let timer: NodeJS.Timeout | null = null;
          let timeoutEscalation: Promise<void> | null = null;
          const pid = proc.pid || 0;
          const commandEnv = opts.env || process.env;
          const signalOwnedProcess = (signal: NodeJS.Signals) => {
            if (process.platform !== "win32" && pid > 0) {
              try {
                process.kill(-pid, signal);
                return;
              } catch {}
            }
            proc.kill(signal);
          };
          const ownedProcessIsAlive = () => {
            if (process.platform === "win32" || pid <= 0) return proc.exitCode == null;
            try {
              process.kill(-pid, 0);
              return true;
            } catch {
              return false;
            }
          };
          const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            fn();
          };
          const requestStop = () => {
            if (timeoutEscalation) return;
            signalOwnedProcess("SIGTERM");
            timeoutEscalation = (async () => {
              const sleep = async (ms: number) =>
                await new Promise((resolve) => setTimeout(resolve, ms));
              const graceMs = Math.max(1, opts.killGraceMs ?? 10_000);
              const termDeadline = Date.now() + graceMs;
              while (ownedProcessIsAlive() && Date.now() < termDeadline) await sleep(25);
              if (ownedProcessIsAlive()) signalOwnedProcess("SIGKILL");
              const killDeadline = Date.now() + 2_000;
              while (ownedProcessIsAlive() && Date.now() < killDeadline) await sleep(25);
            })();
          };
          const onInterrupt = () => requestStop();
          process.once("SIGINT", onInterrupt);
          process.once("SIGTERM", onInterrupt);
          removeSignalHandlers = () => {
            process.off("SIGINT", onInterrupt);
            process.off("SIGTERM", onInterrupt);
          };
          stopWatchdog = startParentWatchdog({
            childPgid: pid,
            cwd: opts.cwd,
            env: commandEnv,
            cleanupPath: capture.cleanupPath,
          });
          timer = opts.timeoutMs
            ? setTimeout(() => {
                timedOut = true;
                requestStop();
              }, opts.timeoutMs)
            : null;
          proc.stdout?.on("data", (chunk) => (stdout += String(chunk)));
          proc.stderr?.on("data", (chunk) => (stderr += String(chunk)));
          proc.on("error", (error) => finish(() => reject(error)));
          proc.on("close", (code, signal) => {
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
            const closedTimedOut = timedOut;
            const closeEscalation = timeoutEscalation;
            void (async () => {
              if (closeEscalation) await closeEscalation;
              if (process.platform === "darwin") {
                ({ stdout, stderr } = await capture.read());
              }
              if (closedTimedOut) {
                return finish(() =>
                  reject(
                    new Error(`${path.basename(opts.command)} timed out after ${opts.timeoutMs}ms`),
                  ),
                );
              }
              const exitCode = code ?? 1;
              if (exitCode === 0 || opts.allowFailure) {
                return finish(() => resolve({ exitCode, stdout, stderr }));
              }
              const details = [stderr, stdout]
                .map((value) => value.trim())
                .filter(Boolean)
                .join("\n");
              finish(() =>
                reject(
                  Object.assign(
                    new Error(
                      `${path.basename(opts.command)} exited with code ${exitCode}${signal ? ` (signal ${signal})` : ""}${details ? `\n${details}` : ""}`,
                    ),
                    { exitCode, stdout, stderr },
                  ),
                ),
              );
            })().catch((error) => finish(() => reject(error)));
          });
        });
      } finally {
        removeSignalHandlers();
        stopWatchdog();
      }
    },
    async () => await capture.cleanup(),
  );
}
