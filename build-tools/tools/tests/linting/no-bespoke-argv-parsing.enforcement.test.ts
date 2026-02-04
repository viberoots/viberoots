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

const EXCLUDED_FILES = new Set([
  "build-tools/tools/lib/cli.ts",
  "build-tools/tools/lib/argv.ts",
  // Some tests intentionally assert behavior by reading process.argv directly.
  "build-tools/tools/tests/lib/node-run.zx-init.args-and-exit-propagation.test.ts",
  "build-tools/tools/tests/lib/buck-daemon-reaper.ts",
]);

const EXCLUDED_PREFIXES = ["build-tools/tools/tests/", "build-tools/tools/scaffolding/templates/"];

const BANNED_PATTERNS: Array<{ re: RegExp; hint: string }> = [
  {
    re: /\bprocess\.argv\.indexOf\(/,
    hint: "Use build-tools/tools/lib/cli.ts (getFlagStr/getFlagBool/hasFlag).",
  },
  {
    re: /\bprocess\.argv\.findIndex\(/,
    hint: "Use build-tools/tools/lib/cli.ts (getFlagStr/getFlagBool/hasFlag).",
  },
  {
    re: /\bprocess\.argv\.slice\(2\)/,
    hint: "Use build-tools/tools/lib/cli.ts (getArgvTokens/getPositionals).",
  },
  {
    re: /\(\s*global(?:This)?\s+as\s+any\s*\)\.argv/,
    hint: "Use build-tools/tools/lib/cli.ts helpers (they handle zx global argv precedence).",
  },
];

function isExcludedDir(relDir: string): boolean {
  if (EXCLUDED_PREFIXES.some((p) => relDir.replaceAll("\\", "/").startsWith(p))) return true;
  const parts = relDir.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.some((p) => EXCLUDED_DIRS.has(p));
}

async function listToolingFiles(repoRoot: string): Promise<string[]> {
  const out: string[] = [];
  const root = path.join(repoRoot, "build-tools", "tools");
  const stack: string[] = [root];

  while (stack.length) {
    const cur = stack.pop()!;
    const relDir = path.relative(repoRoot, cur).replaceAll("\\", "/");
    if (isExcludedDir(relDir)) continue;

    let ents: Array<any> = [];
    try {
      ents = await fsp.readdir(cur, { withFileTypes: true } as any);
    } catch {
      continue;
    }

    for (const e of ents) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!e.name.endsWith(".ts")) continue;
      out.push(abs);
    }
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}

test("tooling entrypoints do not hand-roll argv parsing (use build-tools/tools/lib/cli.ts)", async () => {
  const repoRoot = process.cwd();
  const files = await listToolingFiles(repoRoot);

  const hits: Array<{ file: string; pattern: string; line: number; hint: string }> = [];
  for (const abs of files) {
    const rel = path.relative(repoRoot, abs).replaceAll("\\", "/");
    if (EXCLUDED_FILES.has(rel)) continue;
    let txt = "";
    try {
      txt = await fsp.readFile(abs, "utf8");
    } catch {
      continue;
    }
    for (const { re, hint } of BANNED_PATTERNS) {
      const m = txt.match(re);
      if (!m) continue;
      const idx = txt.indexOf(m[0]);
      const line = idx >= 0 ? txt.slice(0, idx).split("\n").length : 0;
      hits.push({ file: rel, pattern: String(re), line, hint });
    }
  }

  if (hits.length > 0) {
    const lines = hits
      .slice(0, 50)
      .map((h) => `- ${h.file}:${h.line} matches ${h.pattern}\n  ${h.hint}`)
      .join("\n");
    const tail = hits.length > 50 ? `\n... and ${hits.length - 50} more` : "";
    throw new Error(
      [
        "Found bespoke argv parsing in tooling code.",
        "Use build-tools/tools/lib/cli.ts for flags and positionals (no direct process.argv/global argv reads).",
        "",
        lines + tail,
      ].join("\n"),
    );
  }
});
