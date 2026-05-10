#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const EXCLUDED_DIRS = new Set([
  ".git",
  ".direnv",
  "buck-out",
  "coverage",
  "node_modules",
  "result",
  "test-logs",
]);

const ALLOWED_PATHS = new Set([
  ".git",
  "build-tools/tools/tests/deployments/nixos-shared-host.control-plane-service-env.test.ts",
  "build-tools/tools/tests/linting/no-stale-viberoots-names.enforcement.test.ts",
  "docs/repo-rename.md",
  "docs/runtime-prefix-migration.md",
  "mayday-test-time-debugging.md",
  "pnpm-lock.yaml",
]);

const ALLOWED_PREFIXES = ["docs/build-history/", "docs/design-history/"];

const STALE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bbucknix\b/g, label: "bucknix" },
  { re: /\bBucknix\b/g, label: "Bucknix" },
  { re: /\bBUCKNIX\b/g, label: "BUCKNIX" },
  { re: /\bbucknix-fresh\b/g, label: "bucknix-fresh" },
  { re: /\bkiltyj\/bucknix-fresh\b/g, label: "kiltyj/bucknix-fresh" },
  { re: /\bgit@github\.com:kiltyj\/bucknix-fresh\.git\b/g, label: "old repo remote" },
  { re: /(^|[^A-Za-z0-9])bnx(?=[^A-Za-z0-9]|$)/g, label: "bnx" },
  { re: /(^|[^A-Za-z0-9])Bnx(?=[^A-Za-z0-9]|$)/g, label: "Bnx" },
  { re: /(^|[^A-Za-z0-9])BNX(?=[^A-Za-z0-9]|$)/g, label: "BNX" },
  { re: /\/srv\/common\b/g, label: "/srv/common deployment path" },
  { re: /\bkiltyj\/common\b/g, label: "kiltyj/common" },
  { re: /\bgit@github\.com:kiltyj\/common\.git\b/g, label: "old common repo remote" },
];

function normalizeRel(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function isAllowedFile(rel: string): boolean {
  return ALLOWED_PATHS.has(rel) || ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

function isExcludedDir(relDir: string): boolean {
  return normalizeRel(relDir)
    .split("/")
    .filter(Boolean)
    .some((part) => EXCLUDED_DIRS.has(part));
}

function lineNumberForOffset(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

async function listRepoFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return String(stdout || "")
      .split("\0")
      .filter(Boolean)
      .map((rel) => path.join(repoRoot, normalizeRel(rel)))
      .sort((a, b) => a.localeCompare(b));
  } catch {}

  const files: string[] = [];
  const stack = [repoRoot];

  while (stack.length > 0) {
    const cur = stack.pop()!;
    const relDir = normalizeRel(path.relative(repoRoot, cur));
    if (isExcludedDir(relDir)) continue;

    for (const entry of await fsp.readdir(cur, { withFileTypes: true })) {
      const abs = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (entry.isFile()) files.push(abs);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

test("active source has no stale bucknix repository names", async () => {
  const repoRoot = process.cwd();
  const hits: string[] = [];

  for (const abs of await listRepoFiles(repoRoot)) {
    const rel = normalizeRel(path.relative(repoRoot, abs));
    if (isAllowedFile(rel)) continue;

    let text = "";
    try {
      text = await fsp.readFile(abs, "utf8");
    } catch {
      continue;
    }

    for (const pattern of STALE_PATTERNS) {
      for (const match of text.matchAll(pattern.re)) {
        hits.push(`${rel}:${lineNumberForOffset(text, match.index ?? 0)} stale ${pattern.label}`);
      }
    }
  }

  if (hits.length > 0) {
    throw new Error(
      ["Found stale repository naming in active source/docs.", ...hits.slice(0, 80)].join("\n"),
    );
  }
});
