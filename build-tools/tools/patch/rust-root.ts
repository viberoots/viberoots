import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { readFlagStrFromTokens } from "../lib/cli";
import { repoRoot } from "./lib/apply";

function canonical(candidate: string): string {
  const absolute = path.resolve(candidate);
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function assertInside(root: string, candidate: string, label: string): void {
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} resolves outside the repository: ${candidate}`);
  }
}

async function nearestCargoRoot(start: string, boundary: string): Promise<string> {
  for (let current = start; ; current = path.dirname(current)) {
    const manifest = path.join(current, "Cargo.toml");
    const lock = path.join(current, "Cargo.lock");
    if (
      await Promise.all(
        [manifest, lock].map((file) =>
          fsp.access(file).then(
            () => true,
            () => false,
          ),
        ),
      ).then((results) => results.every(Boolean))
    ) {
      return current;
    }
    if (current === boundary || path.dirname(current) === current) break;
  }
  throw new Error(`Cargo.toml and Cargo.lock were not found from ${start}`);
}

function packageFromTarget(target: string): string {
  const clean = target.replace(/^root\/\//, "//").replace(/^\/\//, "");
  const colon = clean.lastIndexOf(":");
  return colon >= 0 ? clean.slice(0, colon) : clean;
}

export async function resolveRustCargoRoot(args: string[]): Promise<string> {
  const root = canonical(repoRoot());
  const importer = readFlagStrFromTokens("importer", "", args).trim();
  const target = readFlagStrFromTokens("target", "", args).trim();
  const importerBase = importer ? canonical(path.resolve(root, importer)) : "";
  const targetBase = target ? canonical(path.resolve(root, packageFromTarget(target))) : "";
  if (importerBase) assertInside(root, importerBase, "--importer");
  if (targetBase) assertInside(root, targetBase, "--target");
  const importerRoot = importerBase ? await nearestCargoRoot(importerBase, root) : "";
  const targetRoot = targetBase ? await nearestCargoRoot(targetBase, root) : "";
  if (importerRoot && targetRoot && importerRoot !== targetRoot) {
    throw new Error("--target and --importer resolve to conflicting Cargo roots");
  }
  const resolved =
    importerRoot || targetRoot || (await nearestCargoRoot(canonical(process.cwd()), root));
  assertInside(root, resolved, "Cargo root");
  return resolved;
}
