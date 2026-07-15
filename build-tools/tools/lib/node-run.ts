import { spawn } from "node:child_process";
import path from "node:path";
import { MANAGED_CANCEL_READY, MANAGED_CANCEL_REQUEST } from "./managed-cancellation";

export type RunNodeWithZxOptions = {
  script: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  nodeBin?: string;
  zxInitPath: string;
  stdio?: "inherit" | "pipe";
  timeoutMs?: number;
  awaitChildOnSignal?: boolean;
  signalCleanupGraceMs?: number;
};

export function nodeFlagsWithZx(zxInitPath: string): string[] {
  return [
    "--experimental-top-level-await",
    "--disable-warning=ExperimentalWarning",
    "--experimental-strip-types",
    "--import",
    zxInitPath,
  ];
}

export function nodeOptionsWithoutZxInit(value: string | undefined): string {
  if (!value) return "";
  const tokens = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] || "";
    const unquoted = token.replace(/^(['"])(.*)\1$/, "$2");
    if (unquoted === "--import") {
      const next = tokens[i + 1] || "";
      const nextUnquoted = next.replace(/^(['"])(.*)\1$/, "$2");
      if (nextUnquoted.endsWith("build-tools/tools/dev/zx-init.mjs")) {
        i++;
        continue;
      }
    }
    if (
      unquoted.startsWith("--import=") &&
      unquoted.slice("--import=".length).endsWith("build-tools/tools/dev/zx-init.mjs")
    ) {
      continue;
    }
    kept.push(token);
  }
  return kept.join(" ");
}

function normalizedNodePath(value: string | undefined, cwd: string): string {
  return (value || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((entry) => (path.isAbsolute(entry) ? entry : path.resolve(cwd, entry)))
    .join(path.delimiter);
}

function childErrorDetails(stdout: string, stderr: string): string {
  const details = [stderr, stdout]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
  if (!details) return "";
  const max = 4096;
  return `\n${details.length > max ? details.slice(details.length - max) : details}`;
}

export async function runNodeWithZx(opts: RunNodeWithZxOptions): Promise<{
  stdout: string;
  stderr: string;
}> {
  const nodeBin = opts.nodeBin || process.execPath;
  const cwd = opts.cwd || process.cwd();
  const env = { ...(opts.env || process.env) };
  env.NODE_OPTIONS = nodeOptionsWithoutZxInit(env.NODE_OPTIONS);
  env.NODE_PATH = normalizedNodePath(env.NODE_PATH, cwd);
  const args = opts.args || [];
  const stdio = opts.stdio || "inherit";
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(0, opts.timeoutMs || 0) : 0;

  const argv = [...nodeFlagsWithZx(opts.zxInitPath), opts.script, ...args];

  return await new Promise((resolve, reject) => {
    const proc = spawn(nodeBin, argv, {
      cwd,
      env,
      stdio: opts.awaitChildOnSignal
        ? stdio === "inherit"
          ? ["inherit", "inherit", "inherit", "ipc"]
          : ["pipe", "pipe", "pipe", "ipc"]
        : stdio,
      detached: opts.awaitChildOnSignal === true,
    });
    let timedOut = false;
    let forwardedSignal: NodeJS.Signals | null = null;
    let killTimer: NodeJS.Timeout | null = null;
    let hardKillTimer: NodeJS.Timeout | null = null;
    let signalKillTimer: NodeJS.Timeout | null = null;
    let cancellationReady = false;
    let cancellationSent = false;
    if (timeoutMs > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill("SIGTERM");
        } catch {}
        hardKillTimer = setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {}
        }, 1500);
      }, timeoutMs);
    }

    const forwardSignal = (signal: NodeJS.Signals): void => {
      if (forwardedSignal) return;
      forwardedSignal = signal;
      sendCancellation();
      signalKillTimer = setTimeout(
        () => {
          if (!proc.pid) return;
          try {
            process.kill(-proc.pid, "SIGKILL");
          } catch {}
        },
        Math.max(1, opts.signalCleanupGraceMs ?? 180_000),
      );
    };
    if (opts.awaitChildOnSignal) {
      proc.on("message", (message: unknown) => {
        if (
          message &&
          typeof message === "object" &&
          (message as { type?: unknown }).type === MANAGED_CANCEL_READY
        ) {
          cancellationReady = true;
          sendCancellation();
        }
      });
      process.once("SIGINT", forwardSignal);
      process.once("SIGTERM", forwardSignal);
    }

    function sendCancellation(): void {
      if (cancellationSent || !cancellationReady || !forwardedSignal || !proc.connected) return;
      cancellationSent = true;
      proc.send({ type: MANAGED_CANCEL_REQUEST, signal: forwardedSignal });
    }

    let stdout = "";
    let stderr = "";
    if (stdio !== "inherit") {
      proc.stdout?.on("data", (b) => (stdout += String(b)));
      proc.stderr?.on("data", (b) => (stderr += String(b)));
    }

    const clearLifecycle = (): void => {
      if (opts.awaitChildOnSignal) {
        process.off("SIGINT", forwardSignal);
        process.off("SIGTERM", forwardSignal);
      }
      if (killTimer) clearTimeout(killTimer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      if (signalKillTimer) clearTimeout(signalKillTimer);
    };
    proc.on("error", (error) => {
      clearLifecycle();
      reject(error);
    });
    proc.on("close", (code, signal) => {
      clearLifecycle();
      if (timedOut) {
        reject(
          Object.assign(new Error(`${path.basename(opts.script)} timed out after ${timeoutMs}ms`), {
            exitCode: 124,
            stdout,
            stderr,
          }),
        );
        return;
      }
      if (forwardedSignal) {
        process.kill(process.pid, forwardedSignal);
        reject(
          Object.assign(
            new Error(
              `${path.basename(opts.script)} interrupted by ${forwardedSignal} after child close`,
            ),
            { exitCode: 128 + (forwardedSignal === "SIGINT" ? 2 : 15), signal: forwardedSignal },
          ),
        );
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const suffix = signal ? ` (signal ${signal})` : "";
      reject(
        Object.assign(
          new Error(
            `${path.basename(opts.script)} exited with code ${code ?? "null"}${suffix}${childErrorDetails(stdout, stderr)}`,
          ),
          { exitCode: code ?? 1, stdout, stderr },
        ),
      );
    });
  });
}
