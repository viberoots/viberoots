import { spawn } from "node:child_process";
import process from "node:process";

import { onManagedCancellation } from "./managed-cancellation";
import { resolveWatchdogShell, watchdogEnvFor } from "./managed-command-watchdog";

export type ManagedCommandResult = {
  ok: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  interrupted: boolean;
};

export type ManagedCommandActivity = {
  startedAtMs: number;
  lastOutputAtMs: number;
  lastEventSnippet: string;
  stdoutBytes: number;
  stderrBytes: number;
  childPid?: number;
  outputChunks?: number;
};

export async function runManagedCommand(opts: {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  killGraceMs?: number;
  activity?: ManagedCommandActivity;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}): Promise<ManagedCommandResult> {
  const timeoutMs = Math.max(0, Number(opts.timeoutMs || 0));
  const killGraceMs = Math.max(1, Number(opts.killGraceMs || 10_000));
  const child = spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    env: opts.env || process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let interrupted = false;
  let ended = false;
  let killTimer: NodeJS.Timeout | null = null;
  let timeoutTimer: NodeJS.Timeout | null = null;
  let watchdogControl: (NodeJS.WritableStream & { unref?: () => void }) | null = null;
  const pid = child.pid || 0;
  const activity: ManagedCommandActivity = opts.activity || {
    startedAtMs: Date.now(),
    lastOutputAtMs: 0,
    lastEventSnippet: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    childPid: pid,
    outputChunks: 0,
  };
  activity.childPid = pid;

  const updateSnippet = (chunk: string): void => {
    const lines = String(chunk || "")
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    const last = lines[lines.length - 1];
    activity.lastEventSnippet = last.length > 220 ? `${last.slice(0, 217)}...` : last;
    activity.lastOutputAtMs = Date.now();
  };

  const terminateGroup = (signal: NodeJS.Signals): void => {
    if (!pid || ended) return;
    try {
      process.kill(-pid, signal);
    } catch {}
  };

  const stopWatchdog = (): void => {
    const control = watchdogControl;
    watchdogControl = null;
    control?.end("stop\n");
  };

  const startParentWatchdog = (): void => {
    if (process.platform === "win32" || !pid) return;
    const graceSec = Math.max(1, Math.ceil(killGraceMs / 1000));
    const parentPid = process.pid;
    const env = opts.env || process.env;
    const shell = resolveWatchdogShell(env);
    const script = [
      "set -u",
      'P="$1"',
      'C="$2"',
      'G="$3"',
      'K="$4"',
      "while :; do",
      '  if ! kill -0 "$C" 2>/dev/null; then',
      "    exit 0",
      "  fi",
      '  if ! kill -0 "$P" 2>/dev/null; then',
      '    kill -TERM -"$G" 2>/dev/null || true',
      '    sleep "$K"',
      '    kill -KILL -"$G" 2>/dev/null || true',
      "    exit 0",
      "  fi",
      "  if IFS= read -r -t 2 _ <&3; then exit 0; fi",
      "done",
    ].join("\n");
    try {
      const debugWatchdog = String(env.MANAGED_COMMAND_DEBUG_WATCHDOG || "") === "1";
      const watchdogEnv = watchdogEnvFor(env);
      const watchdogArgs = [
        "--noprofile",
        "--norc",
        "-c",
        script,
        "watchdog",
        ...[parentPid, pid, pid, graceSec].map(String),
      ];
      const wd = spawn(shell, watchdogArgs, {
        cwd: opts.cwd,
        env: watchdogEnv,
        stdio: debugWatchdog
          ? ["ignore", "pipe", "pipe", "pipe"]
          : ["ignore", "ignore", "ignore", "pipe"],
        detached: true,
      });
      const watchdogPid = wd.pid || 0;
      watchdogControl = wd.stdio[3] as (NodeJS.WritableStream & { unref?: () => void }) | null;
      watchdogControl?.on("error", () => {});
      watchdogControl?.unref?.();
      wd.once("error", (err) => {
        if (!debugWatchdog) return;
        try {
          console.error(`[managed-command] watchdog error: ${String(err)}`);
        } catch {}
      });
      if (debugWatchdog) {
        wd.stdout?.setEncoding("utf8");
        wd.stderr?.setEncoding("utf8");
        wd.stdout?.on("data", (chunk: string) => {
          try {
            console.error(`[managed-command] watchdog stdout: ${String(chunk).trim()}`);
          } catch {}
        });
        wd.stderr?.on("data", (chunk: string) => {
          try {
            console.error(`[managed-command] watchdog stderr: ${String(chunk).trim()}`);
          } catch {}
        });
        wd.once("exit", (code, signal) => {
          try {
            console.error(
              `[managed-command] watchdog exited pid=${watchdogPid} code=${String(code)} signal=${String(signal)}`,
            );
          } catch {}
        });
        try {
          console.error(
            `[managed-command] watchdog started pid=${watchdogPid} parent=${parentPid} child=${pid}`,
          );
        } catch {}
      }
      wd.unref();
    } catch {}
  };
  startParentWatchdog();

  const requestStop = (): void => {
    terminateGroup("SIGTERM");
    if (killTimer) return;
    killTimer = setTimeout(() => {
      terminateGroup("SIGKILL");
    }, killGraceMs);
  };

  const onInterrupt = (): void => {
    interrupted = true;
    requestStop();
  };

  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);
  const removeManagedCancellation = onManagedCancellation(onInterrupt);

  if (timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      requestStop();
    }, timeoutMs);
  }

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
    activity.stdoutBytes += Buffer.byteLength(chunk, "utf8");
    activity.outputChunks += 1;
    updateSnippet(chunk);
    opts.onStdout?.(chunk);
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
    activity.stderrBytes += Buffer.byteLength(chunk, "utf8");
    activity.outputChunks += 1;
    updateSnippet(chunk);
    opts.onStderr?.(chunk);
  });

  const result = await new Promise<ManagedCommandResult>((resolve) => {
    let resolved = false;
    const finish = (result: ManagedCommandResult): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };
    child.once("error", (err) => {
      ended = true;
      const message = String(err && (err.stack || err.message) ? err.stack || err.message : err);
      stderr += [
        `failed to spawn command: ${opts.command}`,
        opts.args.length > 0 ? `args: ${opts.args.join(" ")}` : "",
        message,
      ]
        .filter(Boolean)
        .join("\n");
      finish({
        ok: false,
        code: null,
        signal: null,
        stdout,
        stderr,
        timedOut,
        interrupted,
      });
    });
    const finishProcess = (code: number | null, signal: NodeJS.Signals | null): void => {
      ended = true;
      finish({
        ok: !timedOut && code === 0,
        code,
        signal,
        stdout,
        stderr,
        timedOut,
        interrupted,
      });
    };
    child.once("close", finishProcess);
  });

  if (timeoutTimer) clearTimeout(timeoutTimer);
  if (killTimer) clearTimeout(killTimer);
  stopWatchdog();
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onInterrupt);
  removeManagedCancellation();
  return result;
}
