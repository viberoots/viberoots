#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";

const BANNED_SUBSTRINGS = [
  "tools/buck/sync-providers-node.ts",
  "tools/buck/sync-providers-python.ts",
];

const TEXT_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".md",
  ".bzl",
  ".nix",
  ".json",
  ".yaml",
  ".yml",
  ".txt",
  ".sh",
  ".bash",
]);

const IGNORE_DIR_NAMES = new Set([
  ".git",
  ".direnv",
  "buck-out",
  "node_modules",
  "coverage",
  ".pnpm-store",
  "result",
  "test-logs",
]);

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function listTextFilesRec(dir: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let ents: Array<any> = [];
    try {
      ents = await fsp.readdir(cur, { withFileTypes: true } as any);
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (IGNORE_DIR_NAMES.has(e.name)) continue;
        stack.push(full);
        continue;
      }
      const ext = path.extname(e.name);
      if (!TEXT_EXTS.has(ext)) continue;
      out.push(full);
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

async function readUtf8IfPossible(file: string): Promise<string | null> {
  try {
    return await fsp.readFile(file, "utf8");
  } catch {
    return null;
  }
}

test("provider sync wrappers are removed; use tools/buck/sync-providers.ts only", async () => {
  const repoRoot = process.cwd();
  const selfAbs = path.join(
    repoRoot,
    "tools",
    "tests",
    "buck",
    "sync-providers.wrapper-entrypoints.removed.test.ts",
  );
  const scanRoots = ["tools", "docs"].map((p) => path.join(repoRoot, p));
  const extraFiles = [
    "build-system-design.md",
    "build-system-final-steps.md",
    "getting-started-on-a-pr.md",
  ].map((p) => path.join(repoRoot, p));

  const files: string[] = [];
  for (const r of scanRoots) files.push(...(await listTextFilesRec(r)));
  for (const f of extraFiles) files.push(f);

  const hits: Array<{ file: string; needle: string }> = [];
  for (const abs of files) {
    if (abs === selfAbs) continue;
    const txt = await readUtf8IfPossible(abs);
    if (!txt) continue;
    for (const needle of BANNED_SUBSTRINGS) {
      if (txt.includes(needle)) hits.push({ file: abs, needle });
    }
  }

  assert(
    hits.length === 0,
    [
      "Found forbidden references to removed provider sync wrapper entrypoints.",
      "Use the unified orchestrator instead: node tools/buck/sync-providers.ts --lang <lang> --no-glue",
      "",
      ...hits.slice(0, 25).map((h) => `- ${path.relative(repoRoot, h.file)}: ${h.needle}`),
      hits.length > 25 ? `... and ${hits.length - 25} more` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
});
