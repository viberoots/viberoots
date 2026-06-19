#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { viberootsRepoPath } from "./deployment-command";

const repoRoot = process.cwd();
const scanRoots = [
  { rel: "build-tools", root: viberootsRepoPath("build-tools") },
  { rel: "docs", root: viberootsRepoPath("docs") },
  { rel: "projects", root: path.join(repoRoot, "projects") },
] as const;
const allowedHistoricalFiles = new Set([
  "docs/history/plans/infisical-plan.md",
  "docs/history/migrations/pleomino-deployment-directory-migration.md",
]);
const stalePatterns = [
  /(?:\/\/)?projects\/deployments\/pleomino-[A-Za-z0-9_-]+(?::|\/|\b)/g,
  /projects\\deployments\\pleomino-[A-Za-z0-9_-]+(?:\\|\b)/g,
  /["']projects["']\s*,\s*["']deployments["']\s*,\s*["']pleomino-[A-Za-z0-9_-]+["']/g,
  /^\s+pleomino-[A-Za-z0-9_-]+\/\s*$/gm,
] as const;
const stalePleominoPackageName = /["']pleomino-(?:dev|staging|prod|shared|infisical)["']/;

async function* walk(
  scanRoot: (typeof scanRoots)[number],
  rel = "",
): AsyncGenerator<{
  rel: string;
  abs: string;
}> {
  const abs = path.join(scanRoot.root, rel);
  const stat = await fsp.stat(abs);
  if (stat.isFile()) {
    yield { rel: path.posix.join(scanRoot.rel, rel), abs };
    return;
  }
  for (const entry of await fsp.readdir(abs, { withFileTypes: true })) {
    if (entry.name === "buck-out" || entry.name === "node_modules") continue;
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) {
      yield* walk(scanRoot, child);
    } else if (entry.isFile()) {
      yield { rel: path.posix.join(scanRoot.rel, child), abs: path.join(scanRoot.root, child) };
    }
  }
}

function stalePathJoinVariables(source: string): string[] {
  const staleVariables = new Set<string>();
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[[^\]]*["']pleomino-(?:dev|staging|prod|shared|infisical)["'][^\]]*\]/g,
  )) {
    staleVariables.add(match[1]!);
  }
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["']pleomino-(?:dev|staging|prod|shared|infisical)["']/g,
  )) {
    staleVariables.add(match[1]!);
  }
  for (const match of source.matchAll(
    /\bfor\s*\(\s*const\s+([A-Za-z_$][\w$]*)\s+of\s+\[[^\]]*["']pleomino-(?:dev|staging|prod|shared|infisical)["'][^\]]*\]\s*\)/g,
  )) {
    staleVariables.add(match[1]!);
  }
  for (const match of source.matchAll(
    /\bfor\s*\(\s*const\s+([A-Za-z_$][\w$]*)\s+of\s+([A-Za-z_$][\w$]*)\s*\)/g,
  )) {
    if (staleVariables.has(match[2]!)) staleVariables.add(match[1]!);
  }
  if (staleVariables.size === 0) return [];

  const stale: string[] = [];
  for (const match of source.matchAll(/path\.join\(([^)]*)\)/g)) {
    const args = match[1]!;
    if (!/["']projects["']\s*,\s*["']deployments["']/.test(args)) continue;
    for (const variable of staleVariables) {
      if (new RegExp(`\\b${variable}\\b`).test(args)) {
        stale.push(match[0]!);
      }
    }
  }
  if (stalePleominoPackageName.test(source)) {
    for (const match of source.matchAll(/path\.join\(([^)]*)\)/g)) {
      const args = match[1]!;
      if (!/["']projects\/deployments["']|["']projects["']\s*,\s*["']deployments["']/.test(args)) {
        continue;
      }
      if (/\b[A-Za-z_$][\w$]*deploymentId\b|\bdeploymentId\b/.test(args)) {
        stale.push(match[0]!);
      }
    }
  }
  return stale;
}

test("active sources do not reference old flat Pleomino deployment package paths", async () => {
  const stale: string[] = [];
  for (const root of scanRoots) {
    for await (const { rel, abs } of walk(root)) {
      if (allowedHistoricalFiles.has(rel)) continue;
      const source = await fsp.readFile(abs, "utf8");
      for (const pattern of stalePatterns) {
        for (const match of source.matchAll(pattern)) {
          stale.push(`${rel}: ${match[0]}`);
        }
      }
      if (stalePleominoPackageName.test(source)) {
        for (const match of stalePathJoinVariables(source)) {
          stale.push(`${rel}: ${match}`);
        }
      }
    }
  }
  assert.deepEqual(stale, []);
});
