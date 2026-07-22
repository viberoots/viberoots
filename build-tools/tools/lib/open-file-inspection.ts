import { spawn } from "node:child_process";
import path from "node:path";
import { ensureNixStoreToolPathSync, resolveToolPathSync } from "./tool-paths";

export function canonicalOpenFileInspectionOptions(env: NodeJS.ProcessEnv): {
  env: NodeJS.ProcessEnv;
  executable: string;
} {
  return { env, executable: ensureNixStoreToolPathSync("lsof", env) };
}

export async function openFileOwnerPids(
  root: string,
  opts: { env?: NodeJS.ProcessEnv; executable?: string; timeoutMs?: number } = {},
): Promise<string[]> {
  const env = opts.env || process.env;
  const executable = opts.executable || resolveToolPathSync("lsof", env);
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

export async function deletedOpenFileOwnerPids(
  root: string,
  opts: { env?: NodeJS.ProcessEnv; executable?: string; timeoutMs?: number } = {},
): Promise<string[]> {
  const env = opts.env || process.env;
  const executable = opts.executable || resolveToolPathSync("lsof", env);
  const timeoutMs = Math.max(250, opts.timeoutMs ?? 5_000);
  return await new Promise<string[]>((resolve, reject) => {
    const child = spawn(executable, ["-Fn", "+L1"], {
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
        reject(new Error(`deleted-open-file inspection failed for ${root}: ${stderr.trim()}`));
        return;
      }
      const owners = new Set<string>();
      let pid = "";
      const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
      for (const line of stdout.split(/\r?\n/u)) {
        if (/^p\d+$/u.test(line)) pid = line.slice(1);
        const file = line.startsWith("n") ? line.slice(1) : "";
        if ((file === root || file.startsWith(prefix)) && pid) owners.add(pid);
      }
      resolve([...owners]);
    });
  });
}
