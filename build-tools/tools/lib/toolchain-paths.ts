#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./repo.ts";

type ToolchainPaths = {
  go?: { bin?: string; root?: string };
  python?: { bin?: string };
};

let cached: Promise<ToolchainPaths | null> | null = null;

function isNixStorePath(p: string): boolean {
  return p === "/nix/store" || p.startsWith("/nix/store/");
}

async function readJsonFile(p: string): Promise<ToolchainPaths | null> {
  try {
    const txt = await fsp.readFile(p, "utf8");
    if (!txt.trim()) return null;
    const parsed = JSON.parse(txt) as ToolchainPaths;
    return parsed || null;
  } catch {
    return null;
  }
}

export async function readToolchainPaths(): Promise<ToolchainPaths | null> {
  if (!cached) {
    cached = (async () => {
      const root = repoRoot();
      const p = path.join(root, "build-tools", "tools", "dev", "toolchain-paths.json");
      return await readJsonFile(p);
    })();
  }
  return await cached;
}

export async function requireGoToolchainBin(): Promise<string> {
  const paths = await readToolchainPaths();
  const bin = String(paths?.go?.bin || "").trim();
  if (!bin) {
    throw new Error(
      "missing Go toolchain path; run `build-tools/tools/dev/gen-toolchain-paths.ts` or `i`",
    );
  }
  if (!isNixStorePath(bin)) {
    throw new Error(`expected Go toolchain in /nix/store, got ${bin}`);
  }
  return bin;
}
