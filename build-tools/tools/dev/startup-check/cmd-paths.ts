#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export function isNixStorePath(p: string): boolean {
  return typeof p === "string" && (p === "/nix/store" || p.startsWith("/nix/store/"));
}

function pathEntries(): string[] {
  return String(process.env.PATH || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function existingExecutablePaths(cmd: string): Promise<string[]> {
  const out: string[] = [];
  for (const dir of pathEntries()) {
    const candidate = path.join(dir, cmd);
    try {
      await fsp.access(candidate);
      out.push(candidate);
    } catch {}
  }
  return out;
}

async function canonicalize(p: string): Promise<string> {
  try {
    return await fsp.realpath(p);
  } catch {
    return p;
  }
}

async function resolveCmdPaths(cmd: string): Promise<string[]> {
  const raw = await existingExecutablePaths(cmd);
  const out: string[] = [];
  for (const p of raw) {
    out.push(await canonicalize(p));
  }
  return Array.from(new Set(out));
}

export async function resolvePreferredCmdPath(cmd: string): Promise<string> {
  const paths = await resolveCmdPaths(cmd);
  const store = paths.find(isNixStorePath);
  return store || paths[0] || "";
}
