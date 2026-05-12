#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getFlagBool, getPositionals } from "../lib/cli";
import {
  ALLOWED_PATHS,
  ALLOWED_PREFIXES,
  MIGRATION_LABEL_SKIP_PATHS,
  PLAN_NUMBER_SKIP_PATHS,
  PLAN_NUMBER_SKIP_PREFIXES,
} from "./stale-names-lint-allowlists";

const execFileAsync = promisify(execFile);
const RETIRED_INPUT_CONTRACT_TERM = ["secret", "spec"].join("");
const RETIRED_INPUT_CONTRACT_TITLE = "Secret" + "spec";

const REPO_NAME_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bbucknix\b/g, label: "stale name: bucknix" },
  { re: /\bBucknix\b/g, label: "stale name: Bucknix" },
  { re: /\bBUCKNIX\b/g, label: "stale name: BUCKNIX" },
  { re: /\bbucknix-fresh\b/g, label: "stale name: bucknix-fresh" },
  { re: /\bkiltyj\/bucknix-fresh\b/g, label: "stale name: kiltyj/bucknix-fresh" },
  { re: /git@github\.com:kiltyj\/bucknix-fresh\.git/g, label: "stale name: old repo remote" },
  { re: /(^|[^A-Za-z0-9])bnx(?=[^A-Za-z0-9]|$)/g, label: "stale name: bnx" },
  { re: /(^|[^A-Za-z0-9])Bnx(?=[^A-Za-z0-9]|$)/g, label: "stale name: Bnx" },
  { re: /(^|[^A-Za-z0-9])BNX(?=[^A-Za-z0-9]|$)/g, label: "stale name: BNX" },
  { re: /\/srv\/common\b/g, label: "stale name: /srv/common deployment path" },
  { re: /\bkiltyj\/common\b/g, label: "stale name: kiltyj/common" },
  { re: /git@github\.com:kiltyj\/common\.git/g, label: "stale name: old common repo remote" },
  { re: /\bkiltyj\/viberoots\b/g, label: "stale name: kiltyj/viberoots" },
  { re: /git@github\.com:kiltyj\/viberoots\.git/g, label: "stale name: old viberoots repo remote" },
  {
    re: new RegExp(`\\b${RETIRED_INPUT_CONTRACT_TERM}\\b`, "g"),
    label: "stale name: retired input-contract term (use SprinkleRef)",
  },
  {
    re: new RegExp(`\\b${RETIRED_INPUT_CONTRACT_TITLE}\\b`, "g"),
    label: "stale name: retired title-case input-contract term (use SprinkleRef)",
  },
];

const PLAN_NUMBER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    re: /(^|[\/._-])pr\d+(?=$|[\/._-])/g,
    label: "completed-plan PR number in file path or identifier (use behavior-based name)",
  },
  {
    re: /\.pr\d+\.(docs|service|errors|happy-path|helpers|test)\b/g,
    label: "completed-plan PR number in test file name (use behavior-based name)",
  },
  {
    re: /\bPR-\d+\b/g,
    label: "completed-plan PR number in identifier or test description (use behavior-based name)",
  },
  {
    re: /\bphase\d+(?![\w-])/g,
    label: "completed-plan phase number in identifier (use behavior-based name)",
  },
  {
    re: /\bPhase-\d+\b/g,
    label: "completed-plan phase number in test description (use behavior-based name)",
  },
];

const MIGRATION_LABEL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    re: /\blegacy[A-Z_][A-Za-z0-9_]*\b|\blegacy-[a-z]/g,
    label: "migration label: legacy* identifier (replace with behavior name or remove)",
  },
  {
    re: /\b(?:v[12]_?[A-Za-z][A-Za-z0-9_]*|[A-Za-z][A-Za-z0-9_]*_v[12]|[a-z][A-Za-z0-9]*V[12]|[A-Z][A-Za-z0-9]*V[12])\b/g,
    label: "migration label: internal v1/v2 identifier (use canonical behavior name)",
  },
];

function normalizeRel(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function isAllowedFile(rel: string): boolean {
  return (
    ALLOWED_PATHS.has(rel) ||
    rel.endsWith("pnpm-lock.yaml") ||
    ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix))
  );
}

function lineNumberForOffset(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function lineTextForOffset(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const end = text.indexOf("\n", offset);
  return text.slice(start, end === -1 ? text.length : end);
}

function isDocFile(rel: string): boolean {
  return rel.endsWith(".md") || rel.endsWith(".rst");
}

function isMarkdownFencedExampleLine(text: string, offset: number): boolean {
  const before = text.slice(0, offset).split("\n");
  let inFence = false;
  for (const line of before) if (/^\s*```/.test(line)) inFence = !inFence;
  return inFence;
}

function isDocCommandLine(text: string, offset: number): boolean {
  const line = lineTextForOffset(text, offset);
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("```")) return false;
  if (isMarkdownFencedExampleLine(text, offset)) return true;
  const knownPrefix =
    /^\$|^>|^\.(?:\/|\s)|^[A-Za-z_][A-Za-z0-9_]*=|^(?:env|cd|make|bash|sh|python|python3|ruby|task|npm|yarn|node|pnpm|v|i|b|scaf|deploy|buck2|nix|git)\b/.test(
      trimmed,
    );
  const commandLike =
    /^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*[A-Za-z][A-Za-z0-9_.-]*(?:\s+|$)/.test(trimmed) &&
    /(?:^|\s)(?:\.{0,2}\/|[A-Za-z0-9_.\/-]+\.(?:bash|bzl|cjs|js|mjs|nix|py|rb|sh|ts|tsx)|run\b|exec\b|test\b|--?[A-Za-z0-9][\w-]*|&&|\|\||[|;])/.test(
      trimmed,
    );
  return knownPrefix || commandLike;
}

function skipPlanNumbers(rel: string): boolean {
  return (
    PLAN_NUMBER_SKIP_PATHS.has(rel) ||
    rel.endsWith("/opentofu/stack.json") ||
    PLAN_NUMBER_SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix))
  );
}

async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return String(stdout || "")
    .split("\0")
    .filter(Boolean)
    .map((rel) => normalizeRel(rel))
    .sort();
}

type Hit = { rel: string; line: number; label: string };

function scanText(rel: string, text: string, lineForOffset: (offset: number) => number): Hit[] {
  const hits: Hit[] = [];
  for (const { re, label } of REPO_NAME_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const index = m.index ?? 0;
      hits.push({ rel, line: lineForOffset(index), label });
    }
  }
  if (!skipPlanNumbers(rel)) {
    for (const { re, label } of PLAN_NUMBER_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const index = m.index ?? 0;
        if (!isDocFile(rel) || isDocCommandLine(text, index)) {
          hits.push({ rel, line: lineForOffset(index), label });
        }
      }
    }
  }
  if (!MIGRATION_LABEL_SKIP_PATHS.has(rel)) {
    for (const { re, label } of MIGRATION_LABEL_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const index = m.index ?? 0;
        if (!isDocFile(rel) || isDocCommandLine(text, index)) {
          hits.push({ rel, line: lineForOffset(index), label });
        }
      }
    }
  }
  return hits;
}

function scanPath(rel: string): Hit[] {
  const patterns = [
    ...REPO_NAME_PATTERNS,
    ...(!skipPlanNumbers(rel) ? PLAN_NUMBER_PATTERNS : []),
    ...(!MIGRATION_LABEL_SKIP_PATHS.has(rel) ? MIGRATION_LABEL_PATTERNS : []),
  ];
  return patterns.flatMap(({ re, label }) =>
    Array.from(rel.matchAll(re), () => ({ rel, line: 1, label })),
  );
}

async function scanFile(repoRoot: string, rel: string): Promise<Hit[]> {
  let text = "";
  try {
    text = await fsp.readFile(path.join(repoRoot, rel), "utf8");
  } catch {
    return [];
  }
  return scanText(rel, text, (offset) => lineNumberForOffset(text, offset));
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const failOnHits = !getFlagBool("no-fail");
  const positional = getPositionals();

  let relPaths: string[];
  if (positional.length > 0) {
    relPaths = positional.map((f) => normalizeRel(path.relative(repoRoot, path.resolve(f))));
  } else {
    // Full active-source scan (verify/CI default).
    relPaths = await listTrackedFiles(repoRoot);
  }

  const hits: Hit[] = [];
  for (const rel of relPaths) {
    if (isAllowedFile(rel)) continue;
    hits.push(...scanPath(rel));
    const fileHits = await scanFile(repoRoot, rel);
    hits.push(...fileHits);
  }

  if (hits.length === 0) {
    process.stderr.write("[stale-names-lint] no stale names found\n");
    return;
  }

  const lines = [
    `[stale-names-lint] found ${hits.length} stale naming hit(s):`,
    ...hits.slice(0, 80).map((h) => `  ${h.rel}:${h.line} ${h.label}`),
    ...(hits.length > 80 ? [`  ... and ${hits.length - 80} more`] : []),
  ];
  process.stderr.write(lines.join("\n") + "\n");
  if (failOnHits) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[stale-names-lint] unexpected error: ${err?.message ?? err}\n`);
  process.exit(2);
});
