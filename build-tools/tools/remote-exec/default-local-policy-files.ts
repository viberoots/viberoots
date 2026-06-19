import fs from "node:fs/promises";
import path from "node:path";
import { classifyDormantSurface, repoPath } from "./default-local-policy-model";

export async function readOptional(root: string, relPath: string): Promise<string> {
  try {
    return await fs.readFile(path.join(root, relPath), "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "";
    throw err;
  }
}

export async function walkFiles(root: string, rel = ""): Promise<string[]> {
  const dir = path.join(root, rel);
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const entry of entries) {
    if ([".git", "node_modules", "buck-out", ".direnv"].includes(entry.name)) continue;
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walkFiles(root, next)));
    if (entry.isFile()) out.push(next);
  }
  return out;
}

export async function candidatePolicyFiles(root: string): Promise<string[]> {
  const files = new Set([
    ".buckconfig",
    "Jenkinsfile",
    "package.json",
    "TESTING.md",
    "toolchains/TARGETS",
  ]);
  for (const base of [
    "viberoots/build-tools/tools/ci",
    "viberoots/build-tools/tools/bin",
    "viberoots/build-tools/tools/dev",
    "viberoots/build-tools/tools/dev/verify",
    "viberoots/build-tools/tools/remote-exec",
    "build-tools/tools/ci",
    "build-tools/tools/bin",
    "build-tools/tools/dev",
    "build-tools/tools/dev/verify",
    "build-tools/tools/remote-exec",
    "docs",
    "toolchains",
  ]) {
    for (const file of await walkFiles(root, base)) files.add(file);
  }
  return [...files].sort();
}

export async function dormantSurfaces(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const file of await walkFiles(root)) {
    const rel = repoPath(root, path.join(root, file));
    if (classifyDormantSurface(rel)) found.push(rel);
  }
  return found.sort();
}
