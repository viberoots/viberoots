import { spawn } from "node:child_process";

export function runCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; stdio?: "ignore" | "inherit" | "pipe" } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: opts.stdio === "pipe" ? ["ignore", "pipe", "pipe"] : opts.stdio || "ignore",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}
