#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const EXCLUDED_DIRS = new Set([
  ".claude",
  ".codex",
  ".git",
  ".direnv",
  ".nix-zsh",
  "buck-out",
  "coverage",
  "dist",
  "docs",
  "node_modules",
  "result",
  "test-logs",
]);

const ALLOWED_PATHS = new Set([
  "build-tools/tools/bin/kill-all",
  "build-tools/tools/dev/tail-log/resolve.ts",
  "build-tools/tools/dev/verify/lock.ts",
  "build-tools/tools/dev/verify/owned-process-state.ts",
  "build-tools/tools/dev/verify/process-control.ts",
  "build-tools/tools/dev/verify/temp-repo-process-cleanup.ts",
  "build-tools/tools/lib/process-inspection.ts",
  "build-tools/tools/lib/shared-buck-isolation-lock.ts",
  "build-tools/tools/tests/dev/verify.orphan-owned-process-cleanup.helpers.ts",
  "build-tools/tools/tests/dev/verify.temp-repo-buck-cleanup.scoped.test.ts",
  "build-tools/tools/tests/lib/buck-daemon-cleanup.interrupted.test.ts",
  "build-tools/tools/tests/lib/buck-daemon-cleanup.non-disruptive.test.ts",
  "build-tools/tools/tests/lib/buck-daemon-reaper.exits-after-parent-exit.test.ts",
  "build-tools/tools/tests/lib/buck-daemon-reaper.ts",
  "build-tools/tools/tests/lib/buck-daemon-reaper.verify-owned-processes.test.ts",
  "build-tools/tools/tests/lib/buck-procs.ps-fallback.test.ts",
  "build-tools/tools/tests/lib/process-inspection.safehouse.test.ts",
  "build-tools/tools/tests/lib/process-tree.ts",
  "build-tools/tools/tests/lib/test-helpers/buck-procs.ts",
  "build-tools/tools/tests/lib/test-helpers/buck-reaper.ts",
  "build-tools/tools/tests/linting/process-inspection-commands.enforcement.test.ts",
  "TESTING.md",
  "ps.txt",
  "projects/apps/pleomino/e2e/process-control.ts",
]);

const PROCESS_INSPECTION_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /resolveToolPath(?:Sync)?\(["']ps["']\)/g, label: "ps tool resolution" },
  { re: /(?:^|[^A-Za-z0-9_-])\/bin\/ps(?:$|[^A-Za-z0-9_-])/g, label: "/bin/ps" },
  { re: /(?:^|[^A-Za-z0-9_-])ps\s+-[A-Za-z]/g, label: "ps command" },
  { re: /(?:^|[^A-Za-z0-9_-])pgrep(?:$|[^A-Za-z0-9_-])/g, label: "pgrep command" },
  { re: /(?:^|[^A-Za-z0-9_-])pkill(?:$|[^A-Za-z0-9_-])/g, label: "pkill command" },
  { re: /(?:^|[^A-Za-z0-9_-])killall(?:$|[^A-Za-z0-9_-])/g, label: "killall command" },
  { re: /(?:^|[^A-Za-z0-9_-])lsof(?:$|[^A-Za-z0-9_-])/g, label: "lsof command" },
];

function normalizeRel(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\.\/+/, "");
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

test("process inspection commands stay in reviewed helper modules", async () => {
  const repoRoot = process.cwd();
  const hits: string[] = [];

  for (const abs of await listRepoFiles(repoRoot)) {
    const rel = normalizeRel(path.relative(repoRoot, abs));
    if (ALLOWED_PATHS.has(rel)) continue;

    let text = "";
    try {
      text = await fsp.readFile(abs, "utf8");
    } catch {
      continue;
    }

    for (const pattern of PROCESS_INSPECTION_PATTERNS) {
      for (const match of text.matchAll(pattern.re)) {
        hits.push(`${rel}:${lineNumberForOffset(text, match.index ?? 0)} direct ${pattern.label}`);
      }
    }
  }

  if (hits.length > 0) {
    throw new Error(
      [
        "Found direct process-inspection command usage outside reviewed helper modules.",
        "Route new usage through an existing process helper or add a narrowly reviewed allowlist entry.",
        ...hits.slice(0, 120),
      ].join("\n"),
    );
  }
});
