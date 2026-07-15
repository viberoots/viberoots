import { spawn } from "node:child_process";
import { resolveToolPathSync } from "./tool-paths";

export async function openFileOwnerPids(
  root: string,
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<string[]> {
  const env = opts.env || process.env;
  const executable = resolveToolPathSync("lsof", env);
  const timeoutMs = Math.max(250, opts.timeoutMs ?? 5_000);

  return await new Promise<string[]>((resolve, reject) => {
    const child = spawn(executable, ["-t", "+D", root], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += String(chunk || "")));
    child.stderr.on("data", (chunk) => (stderr += String(chunk || "")));
    child.on("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut || signal || (code !== 0 && (code !== 1 || stderr.trim()))) {
        reject(new Error(`open-file inspection failed for ${root}`));
        return;
      }
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.some((line) => !/^\d+$/.test(line))) {
        reject(new Error(`open-file inspection returned invalid output for ${root}`));
        return;
      }
      resolve(Array.from(new Set(lines)));
    });
  });
}
