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

export async function runNodeWithZx(opts: RunNodeWithZxOptions): Promise<{
  stdout: string;
  stderr: string;
}> {
  const nodeBin = opts.nodeBin || process.execPath;
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;
  const args = opts.args || [];
  const stdio = opts.stdio || "inherit";

  const argv = [...nodeFlagsWithZx(opts.zxInitPath), opts.script, ...args];

  return await new Promise((resolve, reject) => {
    const proc = spawn(nodeBin, argv, {
      cwd,
      env,
      stdio: stdio === "inherit" ? "inherit" : "pipe",
    });

    let stdout = "";
    let stderr = "";
    if (stdio !== "inherit") {
      proc.stdout?.on("data", (b) => (stdout += String(b)));
      proc.stderr?.on("data", (b) => (stderr += String(b)));
    }

    proc.on("error", reject);
    proc.on("exit", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const suffix = signal ? ` (signal ${signal})` : "";
      reject(
        Object.assign(
          new Error(`${path.basename(opts.script)} exited with code ${code ?? "null"}${suffix}`),
          { exitCode: code ?? 1, stdout, stderr },
        ),
      );
    });
  });
}
