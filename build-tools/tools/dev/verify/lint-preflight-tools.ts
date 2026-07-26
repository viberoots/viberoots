import { spawnSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { isVbrVerbose } from "../../lib/command-ui";
import { repoNodeBinCandidates, resolveRepoNodeBin } from "../../lib/repo-node-bin";

async function firstExisting(root: string, relCandidates: string[]): Promise<string> {
  for (const rel of relCandidates) {
    const candidate = path.join(root, rel);
    try {
      await fsp.access(candidate);
      return rel;
    } catch {}
  }
  return relCandidates[0] || "";
}

export function envWithZxNodeModules(zxNodeModulesOut?: string | null): NodeJS.ProcessEnv {
  const outPath = String(zxNodeModulesOut || "").trim();
  const canonicalNodeBin = path.dirname(process.execPath);
  const currentPath = String(process.env.PATH || "")
    .split(path.delimiter)
    .filter((entry) => entry && entry !== canonicalNodeBin);
  const env = {
    ...process.env,
    PATH: [canonicalNodeBin, ...currentPath].join(path.delimiter),
  };
  if (!outPath) return env;
  const nodeModules = path.join(outPath, "node_modules");
  return {
    ...env,
    ZX_TEST_NODE_MODULES_OUT: outPath,
    NODE_PATH: [nodeModules, process.env.NODE_PATH || ""].filter(Boolean).join(path.delimiter),
  };
}

export async function resolveVerifyNodeBin(
  root: string,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  try {
    return await resolveRepoNodeBin(root, name, env);
  } catch {}
  const candidates = await repoNodeBinCandidates(root, name, env);
  process.stderr.write(
    `error: verify lint preflight requires ${name}; checked ${candidates.join(", ")} and PATH. Run 'i' to provision repo dev tools before re-running 'v'\n`,
  );
  process.exit(2);
}

export function runFormatter(
  timeoutPath: string,
  secs: number,
  formatterPath: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): { exitCode: number; stderr: string; stdout: string } {
  const result = spawnSync(timeoutPath, ["-k", "10s", `${secs}s`, formatterPath, ...args], {
    cwd,
    encoding: "utf8",
    env,
    stdio: isVbrVerbose() ? "inherit" : "pipe",
  });
  return {
    exitCode: result.status ?? 1,
    stderr: String(result.stderr || result.error?.message || ""),
    stdout: String(result.stdout || ""),
  };
}

export async function resolveEslintConfig(root: string): Promise<string> {
  return path.join(
    root,
    await firstExisting(root, ["eslint.config.js", "viberoots/eslint.config.js"]),
  );
}
