import * as fsp from "node:fs/promises";
import path from "node:path";
import { readFlagStrFromTokens } from "../lib/cli";
import { repoRoot } from "./lib/apply";

async function canonicalDestination(candidate: string): Promise<string> {
  const suffix: string[] = [];
  let current = path.resolve(candidate);
  for (;;) {
    try {
      const real = await fsp.realpath(current);
      return path.join(real, ...suffix.reverse());
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(candidate);
    suffix.push(path.basename(current));
    current = parent;
  }
}

export async function rustPatchDir(cargoRoot: string, args: string[]): Promise<string> {
  const override = readFlagStrFromTokens("patch-dir", "", args).trim();
  const raw = override
    ? path.isAbsolute(override)
      ? override
      : path.resolve(repoRoot(), override)
    : path.join(cargoRoot, "patches/rust");
  const [canonicalRoot, patchDir] = await Promise.all([
    fsp.realpath(cargoRoot),
    canonicalDestination(raw),
  ]);
  const relative = path.relative(canonicalRoot, patchDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Rust patch destination must remain inside its Cargo root: ${patchDir}`);
  }
  return patchDir;
}
