#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRootFromModule = path.resolve(here, "../../../..");

function candidateRoots(): string[] {
  return [
    process.env.VIBEROOTS_ROOT || "",
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    path.join(process.cwd(), "viberoots"),
    path.join(process.cwd(), ".viberoots", "current"),
    sourceRootFromModule,
    process.cwd(),
  ].filter(Boolean);
}

export function viberootsToolScript(rel: string): string {
  return viberootsRepoPath(rel);
}

export function viberootsRepoPath(rel: string): string {
  const candidates = rel.startsWith("viberoots/") ? [rel.slice("viberoots/".length), rel] : [rel];
  for (const root of candidateRoots()) {
    for (const candidateRel of candidates) {
      const candidate = path.resolve(root, candidateRel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`could not resolve viberoots repo path: ${rel}`);
}
