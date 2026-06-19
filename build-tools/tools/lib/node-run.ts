import { spawn } from "node:child_process";
import path from "node:path";

export type RunNodeWithZxOptions = {
  script: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  nodeBin?: string;
  zxInitPath: string;
  stdio?: "inherit" | "pipe";
  timeoutMs?: number;
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
  const args = opts.args || [];
  const stdio = opts.stdio || "inherit";
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(0, opts.timeoutMs || 0) : 0;

  const argv = [...nodeFlagsWithZx(opts.zxInitPath), opts.script, ...args];

  return await new Promise((resolve, reject) => {
    const proc = spawn(nodeBin, argv, {
      cwd,
      env,
      stdio: stdio === "inherit" ? "inherit" : "pipe",
    });
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;
    let hardKillTimer: NodeJS.Timeout | null = null;
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

    let stdout = "";
    let stderr = "";
    if (stdio !== "inherit") {
      proc.stdout?.on("data", (b) => (stdout += String(b)));
      proc.stderr?.on("data", (b) => (stderr += String(b)));
    }

    proc.on("error", reject);
    proc.on("exit", (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
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
