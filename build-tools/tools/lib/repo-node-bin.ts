import * as fsp from "node:fs/promises";
import path from "node:path";

import { resolveToolPath } from "./tool-paths";

async function buildToolsRoot(root: string): Promise<string> {
  const current = path.resolve(root, ".viberoots/current/build-tools");
  const currentZx = path.join(current, "tools", "dev", "zx-init.mjs");
  const visible = path.resolve(root, "viberoots", "build-tools");
  const visibleZx = path.join(visible, "tools", "dev", "zx-init.mjs");
  try {
    await fsp.access(currentZx);
    return current;
  } catch {}
  try {
    await fsp.access(visibleZx);
    return visible;
  } catch {}
  return path.resolve(root, "build-tools");
}

export async function repoNodeBinCandidates(
  root: string,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const toolsRoot = await buildToolsRoot(root);
  const envNodeBin = String(env.VIBEROOTS_NODE_BIN || "").trim();
  return Array.from(
    new Set([
      path.join(root, "node_modules", ".bin", name),
      path.join(path.dirname(toolsRoot), "node_modules", ".bin", name),
      ...(envNodeBin ? [path.join(envNodeBin, name)] : []),
      path.join(root, "viberoots", "node_modules", ".bin", name),
    ]),
  );
}

export async function resolveRepoNodeBin(
  root: string,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const candidates = await repoNodeBinCandidates(root, name, env);
  for (const candidate of candidates) {
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {}
  }
  return await resolveToolPath(name, env);
}

export async function requireRepoNodeBin(
  root: string,
  name: string,
  opts: { commandName: string; retryCommand?: string; env?: NodeJS.ProcessEnv },
): Promise<string> {
  try {
    return await resolveRepoNodeBin(root, name, opts.env || process.env);
  } catch {}
  const env = opts.env || process.env;
  const candidates = await repoNodeBinCandidates(root, name, env);
  const retry = opts.retryCommand || "i";
  throw new Error(
    [
      `error: ${opts.commandName} requires ${name}, but it is not available in this workspace.`,
      `checked: ${candidates.join(", ")} and PATH`,
      `hint: run '${retry}' to provision repo dev tools, then re-run '${opts.commandName}'`,
    ].join("\n"),
  );
}
