#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { getFlagBool } from "../lib/cli.ts";

type FindingType = "filename" | "symbol" | "string_literal" | "target_reference" | "doc_reference";

type Finding = {
  type: FindingType;
  file: string;
  line?: number;
  excerpt?: string;
};

const NUMBERING_PATTERNS: RegExp[] = [
  /\bpr[-_ ]?\d+(?:\.\d+|[a-z])?\b/i,
  /\bphase[-_ ]?\d+(?:\.\d+|[a-z])?\b/i,
  /\bPR-\d+(?:\.\d+|[A-Z])?\b/,
  /\bPhase\s*\d+\b/,
];

const TARGET_REF_PATTERN = /\/\/:[A-Za-z0-9_.-]*(?:pr[-_ ]?\d+|phase[-_ ]?\d+)[A-Za-z0-9_.-]*/i;
const STRING_WITH_NUMBERING_PATTERN =
  /(["'`])([^"'`\n]*(?:pr[-_ ]?\d+|phase[-_ ]?\d+|PR-\d+|Phase\s*\d+)[^"'`\n]*)\1/;
const SYMBOL_PATTERN = /\b[A-Za-z_][A-Za-z0-9_.-]*\b/g;

const DOC_ALLOWLIST_PREFIXES = [
  "docs/design-history/",
  "docs/build-history/",
  "docs/pnpm/",
  "docs/handbook/nix-gaps-prs.md",
  "docs/build-history/vite-ssr.md",
  "docs/build-history/webapp-ssr.md",
];
const DOC_ARTIFACT_REF_PATTERN =
  /(build-tools\/tools\/tests\/[A-Za-z0-9_./-]+|\/\/:[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\.test\.ts)/;
const FILE_ALLOWLIST = new Set([
  "build-tools/tools/tests/dev/node-route-doc-contract-check.test.ts",
  "build-tools/tools/dev/node-route-doc-contract-check.ts",
  "build-tools/tools/dev/naming-numbering-check.ts",
  "build-tools/tools/tests/scaffolding/doc-command-contract.inventory.ts",
  "build-tools/tools/tests/scaffolding/ts-command-path.docs-contract.test.ts",
]);

const SCAN_GLOBS = [
  "build-tools/tools/tests/**/*.{ts,bzl}",
  "build-tools/tools/nix/planner/**/*.{nix,ts}",
  "build-tools/tools/nix/langs.json",
  "build-tools/tools/dev/nix-gaps-baseline.ts",
  "build-tools/docs/**/*.md",
  "docs/handbook/**/*.md",
];
const IGNORE_GLOBS = ["**/node_modules/**", "**/buck-out/**", "**/.direnv/**", "**/.git/**"];

function normalizeRel(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function hasNumbering(text: string): boolean {
  return NUMBERING_PATTERNS.some((rx) => rx.test(text));
}

function isDocFile(rel: string): boolean {
  return rel.endsWith(".md");
}

function isDocAllowlisted(rel: string): boolean {
  return DOC_ALLOWLIST_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(prefix));
}

function pushFinding(out: Finding[], next: Finding): void {
  out.push(next);
}

async function listFiles(root: string): Promise<string[]> {
  const files = await fg(SCAN_GLOBS, {
    cwd: root,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
    ignore: IGNORE_GLOBS,
  });
  return files.map(normalizeRel).sort();
}

function checkFilename(rel: string, out: Finding[]): void {
  if (isDocFile(rel)) return;
  const base = path.basename(rel);
  if (hasNumbering(base)) pushFinding(out, { type: "filename", file: rel });
}

function lineExcerpt(line: string): string {
  return line.trim().slice(0, 180);
}

function classifyLine(rel: string, line: string): FindingType {
  if (isDocFile(rel)) return "doc_reference";
  if (TARGET_REF_PATTERN.test(line)) return "target_reference";
  if (STRING_WITH_NUMBERING_PATTERN.test(line)) return "string_literal";
  return "symbol";
}

function hasNumberishSymbol(line: string): boolean {
  const matches = line.match(SYMBOL_PATTERN);
  if (!matches) return false;
  return matches.some((tok) => hasNumbering(tok));
}

function lineHasFinding(rel: string, line: string): boolean {
  if (!hasNumbering(line)) return false;
  if (isDocFile(rel) && !DOC_ARTIFACT_REF_PATTERN.test(line)) return false;
  const type = classifyLine(rel, line);
  if (type === "symbol") return hasNumberishSymbol(line);
  return true;
}

async function collectFindings(root: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const files = await listFiles(root);
  for (const rel of files) {
    if (FILE_ALLOWLIST.has(rel)) continue;
    checkFilename(rel, findings);
    const abs = path.join(root, rel);
    let content = "";
    try {
      content = await fsp.readFile(abs, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || "";
      if (!lineHasFinding(rel, line)) continue;
      pushFinding(findings, {
        type: classifyLine(rel, line),
        file: rel,
        line: i + 1,
        excerpt: lineExcerpt(line),
      });
    }
  }
  return findings;
}

function applyAllowlist(findings: Finding[]): Finding[] {
  return findings.filter((f) => !(f.type === "doc_reference" && isDocAllowlisted(f.file)));
}

function groupFindings(findings: Finding[]): Record<FindingType, Finding[]> {
  return {
    filename: findings.filter((f) => f.type === "filename"),
    symbol: findings.filter((f) => f.type === "symbol"),
    string_literal: findings.filter((f) => f.type === "string_literal"),
    target_reference: findings.filter((f) => f.type === "target_reference"),
    doc_reference: findings.filter((f) => f.type === "doc_reference"),
  };
}

function printHuman(grouped: Record<FindingType, Finding[]>): void {
  const order: FindingType[] = [
    "filename",
    "symbol",
    "string_literal",
    "target_reference",
    "doc_reference",
  ];
  for (const type of order) {
    const rows = grouped[type];
    if (rows.length === 0) continue;
    console.log(`${type}: ${rows.length}`);
    for (const row of rows) {
      const at = row.line ? `:${row.line}` : "";
      const suffix = row.excerpt ? ` :: ${row.excerpt}` : "";
      console.log(`  - ${row.file}${at}${suffix}`);
    }
  }
}

async function main() {
  const root = process.cwd();
  const asJson = getFlagBool("json");
  const failOnFindings = !getFlagBool("warn-only");
  const findings = applyAllowlist(await collectFindings(root));
  const grouped = groupFindings(findings);
  const total = findings.length;
  if (asJson) {
    console.log(JSON.stringify({ total, grouped }, null, 2));
  } else if (total > 0) {
    printHuman(grouped);
  } else {
    console.log("naming-numbering-check: OK");
  }
  if (total > 0 && failOnFindings) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
