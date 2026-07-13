import path from "node:path";
import { spawn } from "node:child_process";

export async function runCommand(opts: {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const proc = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env || process.env,
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    proc.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    proc.on("error", reject);
    proc.on("exit", (code, signal) => {
      const exitCode = code ?? 1;
      if (exitCode === 0 || opts.allowFailure) return resolve({ exitCode, stdout, stderr });
      const details = [stderr, stdout]
        .map((value) => value.trim())
        .filter(Boolean)
        .join("\n");
      reject(
        Object.assign(
          new Error(
            `${path.basename(opts.command)} exited with code ${exitCode}${signal ? ` (signal ${signal})` : ""}${details ? `\n${details}` : ""}`,
          ),
          { exitCode, stdout, stderr },
        ),
      );
    });
  });
}
