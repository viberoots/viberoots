import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function executableExtensions(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32") return [""];
  const pathext = String(env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean);
  return pathext.length > 0 ? pathext : [""];
}

function candidateToolPaths(tool: string, env: NodeJS.ProcessEnv): string[] {
  const pathEntries = String(env.PATH || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const exts = executableExtensions(env);
  const candidates: string[] = [];
  for (const entry of pathEntries) {
    for (const ext of exts) {
      candidates.push(path.join(entry, process.platform === "win32" ? `${tool}${ext}` : tool));
    }
  }
  return Array.from(new Set(candidates));
}

function isNixStorePath(candidate: string): boolean {
  return candidate.includes(`${path.sep}nix${path.sep}store${path.sep}`);
}

function isExecutable(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function preferredCandidate(tool: string, env: NodeJS.ProcessEnv): string {
  const candidates = candidateToolPaths(tool, env);
  for (const candidate of candidates) {
    if (isNixStorePath(candidate) && isExecutable(candidate)) return candidate;
  }
  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate;
  }
  throw new Error(`required tool not found on PATH: ${tool}`);
}

export function resolveToolPathSync(tool: string, env: NodeJS.ProcessEnv = process.env): string {
  return preferredCandidate(tool, env);
}

export function ensureNixStoreToolPathSync(
  tool: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const resolved = resolveToolPathSync(tool, env);
  if (!isNixStorePath(resolved)) {
    throw new Error(`required tool must resolve to /nix/store: ${tool} -> ${resolved}`);
  }
  return resolved;
}

function parseSemver(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:\D.*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemverDesc(a: [number, number, number], b: [number, number, number]): number {
  for (let idx = 0; idx < 3; idx++) {
    const diff = b[idx] - a[idx];
    if (diff !== 0) return diff;
  }
  return 0;
}

export function ensureNixStorePnpm11PathSync(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = candidateToolPaths("pnpm", env).filter(
    (candidate) => isNixStorePath(candidate) && isExecutable(candidate),
  );
  const versions = candidates
    .map((candidate) => {
      const result = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        env,
        timeout: 10_000,
      });
      if (result.status !== 0) return null;
      const version = parseSemver(String(result.stdout || ""));
      return version ? { candidate, version } : null;
    })
    .filter((entry): entry is { candidate: string; version: [number, number, number] } =>
      Boolean(entry),
    )
    .sort((a, b) => compareSemverDesc(a.version, b.version));
  const selected = versions[0];
  if (!selected) {
    throw new Error("required tool must resolve to /nix/store: pnpm");
  }
  if (selected.version[0] < 11) {
    throw new Error(
      `exact pnpm store population requires pnpm >= 11; resolved ${selected.version.join(".")} at ${selected.candidate}`,
    );
  }
  return selected.candidate;
}

export async function resolveToolPath(
  tool: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return resolveToolPathSync(tool, env);
}
