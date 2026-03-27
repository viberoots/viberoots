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

export async function resolveToolPath(
  tool: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return resolveToolPathSync(tool, env);
}
