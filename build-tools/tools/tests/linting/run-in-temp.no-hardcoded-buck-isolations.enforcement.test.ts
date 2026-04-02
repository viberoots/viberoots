#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const EXCLUDED_DIRS = new Set([
  ".git",
  ".direnv",
  "buck-out",
  "node_modules",
  "coverage",
  "result",
  "test-logs",
]);

const RUN_IN_TEMP_RE = /\brunInTemp\s*\(/;
const HARDCODED_BUCK_ISO_RE = /buck2 --isolation-dir [A-Za-z_][A-Za-z0-9_]*/g;
const ALLOW_COMMENT = "lint: allow-hardcoded-buck-isolation";

function normalizeRelPath(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function lineNumberForOffset(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

async function listTestFiles(repoRoot: string): Promise<string[]> {
  const out: string[] = [];
  const root = path.join(repoRoot, "build-tools", "tools", "tests");
  const stack: string[] = [root];

  while (stack.length) {
    const cur = stack.pop()!;
    const relDir = normalizeRelPath(path.relative(repoRoot, cur));
    const parts = relDir.split("/").filter(Boolean);
    if (parts.some((part) => EXCLUDED_DIRS.has(part))) continue;

    let entries: Array<any> = [];
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true } as any);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const abs = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (entry.name.endsWith(".test.ts")) out.push(abs);
    }
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}

test("runInTemp tests reuse inherited buck isolation unless explicitly opted out", async () => {
  const repoRoot = process.cwd();
  const files = await listTestFiles(repoRoot);
  const hits: Array<{ file: string; line: number }> = [];

  for (const abs of files) {
    const rel = normalizeRelPath(path.relative(repoRoot, abs));
    const text = await fsp.readFile(abs, "utf8");
    if (!RUN_IN_TEMP_RE.test(text)) continue;
    if (text.includes(ALLOW_COMMENT)) continue;

    for (const match of text.matchAll(HARDCODED_BUCK_ISO_RE)) {
      const offset = match.index ?? 0;
      hits.push({
        file: rel,
        line: lineNumberForOffset(text, offset),
      });
    }
  }

  if (hits.length > 0) {
    const details = hits
      .slice(0, 50)
      .map(
        (hit) =>
          `- ${hit.file}:${hit.line} use inheritedBuckIsolation(...) or BUCK_NESTED_ISO instead of a hardcoded literal --isolation-dir inside runInTemp`,
      )
      .join("\n");
    const tail = hits.length > 50 ? `\n... and ${hits.length - 50} more` : "";
    throw new Error(
      [
        "Found runInTemp tests with hardcoded literal buck isolation names.",
        "These tests already have temp-repo isolation, so literal nested buck isolations create extra daemons and can exhaust file watchers under verify concurrency.",
        `If a test truly requires an independent nested daemon, add '${ALLOW_COMMENT}' with a short justification.`,
        "",
        details + tail,
      ].join("\n"),
    );
  }
});
