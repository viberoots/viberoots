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
const EXPLICIT_BUCK_ISO_RE = /\bbuck2\s+--isolation-dir\b/;
const APPROVED_INHERITED_ISO_RE = /\binheritedBuckIsolation\s*\(|\bBUCK_NESTED_ISO\b/;
const ALLOW_COMMENT = "lint: allow-hardcoded-buck-isolation";
const SELF_TEST_PATH =
  "build-tools/tools/tests/linting/run-in-temp.no-hardcoded-buck-isolations.enforcement.test.ts";

function normalizeRelPath(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function allowCommentHasJustification(line: string): boolean {
  const idx = line.indexOf(ALLOW_COMMENT);
  if (idx < 0) return false;
  const suffix = line
    .slice(idx + ALLOW_COMMENT.length)
    .replace(/^[:\s-]+/, "")
    .trim();
  return suffix.length >= 12;
}

function findExplicitIsolationViolations(text: string): Array<{ line: number; reason: string }> {
  if (!RUN_IN_TEMP_RE.test(text)) return [];
  const hits: Array<{ line: number; reason: string }> = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] || "";
    if (!EXPLICIT_BUCK_ISO_RE.test(line)) continue;
    if (APPROVED_INHERITED_ISO_RE.test(line)) continue;
    const allowLine = [line, lines[index - 1] || ""].find((candidate) =>
      candidate.includes(ALLOW_COMMENT),
    );
    if (allowLine) {
      if (!allowCommentHasJustification(allowLine)) {
        hits.push({ line: index + 1, reason: "allow comment needs a justification" });
      }
      continue;
    }
    hits.push({ line: index + 1, reason: "use the registered runInTemp buck isolation" });
  }
  return hits;
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

test("runInTemp isolation lint catches computed explicit buck isolations", () => {
  const bad = String.raw`
import { runInTemp } from "../lib/test-helpers";
await runInTemp("bad", async (tmp, $) => {
  const iso = isoForTmp(tmp);
  await $\`buck2 --isolation-dir \${iso} build //:x\`;
  await $\`buck2 --isolation-dir \${isoForTmp(tmp)} test //:x\`;
});
`;
  const hits = findExplicitIsolationViolations(bad);
  if (hits.length !== 2) {
    throw new Error(`expected 2 violations, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp isolation lint accepts shim and inherited isolation patterns", () => {
  const good = String.raw`
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";
await runInTemp("good", async (tmp, $) => {
  await $\`buck2 build //:x\`;
  await $\`buck2 --isolation-dir \${inheritedBuckIsolation("good")} cquery //:x\`;
});
`;
  const hits = findExplicitIsolationViolations(good);
  if (hits.length !== 0) {
    throw new Error(`expected no violations, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp isolation lint requires allow-comment justification", () => {
  const bad = String.raw`
import { runInTemp } from "../lib/test-helpers";
await runInTemp("bad", async (tmp, $) => {
  // ${ALLOW_COMMENT}
  await $\`buck2 --isolation-dir separate build //:x\`;
});
`;
  const hits = findExplicitIsolationViolations(bad);
  if (hits.length !== 1 || !hits[0]?.reason.includes("justification")) {
    throw new Error(`expected missing-justification violation, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp tests reuse inherited buck isolation unless explicitly opted out", async () => {
  const repoRoot = process.cwd();
  const files = await listTestFiles(repoRoot);
  const hits: Array<{ file: string; line: number; reason: string }> = [];

  for (const abs of files) {
    const rel = normalizeRelPath(path.relative(repoRoot, abs));
    if (rel === SELF_TEST_PATH) continue;
    const text = await fsp.readFile(abs, "utf8");
    for (const hit of findExplicitIsolationViolations(text)) {
      hits.push({
        file: rel,
        line: hit.line,
        reason: hit.reason,
      });
    }
  }

  if (hits.length > 0) {
    const details = hits
      .slice(0, 50)
      .map(
        (hit) =>
          `- ${hit.file}:${hit.line} ${hit.reason}; use plain buck2 so the shim injects the registered isolation, or inheritedBuckIsolation(...) when the isolation must be explicit`,
      )
      .join("\n");
    const tail = hits.length > 50 ? `\n... and ${hits.length - 50} more` : "";
    throw new Error(
      [
        "Found runInTemp tests with explicit Buck isolation names.",
        "These tests already have registered temp-repo isolation, so independent nested Buck isolations bypass verify cleanup.",
        `If a test truly requires an independent nested daemon, add '${ALLOW_COMMENT}: <why this cannot reuse the registered isolation>'.`,
        "",
        details + tail,
      ].join("\n"),
    );
  }
});
