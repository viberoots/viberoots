#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";

type Finding = { file: string; line: number; text: string };

function isAllowed(filePath: string): boolean {
  const p = filePath.replace(/\\/g, "/");
  const allow = [
    /^tools\/buck\/exporter\//,
    /^tools\/buck\/export-graph\.ts$/,
    /^tools\/buck\/gen-auto-map\.ts$/,
    /^tools\/buck\/prebuild\//,
    /^tools\/buck\/prebuild-guard\.ts$/,
    /^tools\/lib\/graph-view\.ts$/,
  ];
  return allow.some((re) => re.test(p));
}

function isExcluded(filePath: string): boolean {
  const p = filePath.replace(/\\/g, "/");
  const exclude = [
    /^tools\/tests\//,
    /^docs\//,
    /^node_modules\//,
    /^buck-out\//,
    /^coverage\//,
    /\.md$/,
    /\.nix$/,
    /\.bzl$/,
  ];
  return exclude.some((re) => re.test(p));
}

// Rough heuristic: only flag when the literal appears in the argument to common read helpers.
// Examples: readGraph(<graph.json>), fs.readFile/readJson/readFileSync(<graph.json>)
const VIOLATION_RE =
  /(readGraph|readFile|readJson|readFileSync)\s*\(\s*["']tools\/buck\/graph\.json["']/;

async function scanFile(file: string): Promise<Finding[]> {
  if (isExcluded(file)) return [];
  if (isAllowed(file)) return [];
  const txt = await fs.readFile(file, "utf8").catch(() => "");
  if (!txt || !txt.includes("tools/buck/graph.json")) return [];
  const findings: Finding[] = [];
  const lines = txt.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (VIOLATION_RE.test(line)) {
      findings.push({ file, line: i + 1, text: line.trim() });
    }
  }
  return findings;
}

async function main() {
  // Recursively walk repository, filtering by extension and exclusions (no git dependence).
  const start = process.cwd();
  const stack: string[] = [start];
  const allFindings: Finding[] = [];
  while (stack.length) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[] = [] as any;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = abs.replace(start + path.sep, "").replace(/\\/g, "/");
      if (e.isDirectory()) {
        // Skip excluded directories early
        if (isExcluded(rel) || /^(\.git|\.direnv|buck-out|node_modules|coverage)\b/.test(rel)) {
          continue;
        }
        stack.push(abs);
        continue;
      }
      if (!/[.](ts|js|mjs|cjs)$/.test(rel)) continue;
      const fnd = await scanFile(rel);
      if (fnd.length) allFindings.push(...fnd);
    }
  }

  if (allFindings.length === 0) {
    console.log("tooling-contract: OK — no raw reads of tools/buck/graph.json detected.");
    return;
  }

  console.error(
    "tooling-contract: ERROR — direct reads of tools/buck/graph.json are forbidden. Use the Composite Graph API instead (tools/lib/graph-view.ts).\n" +
      "Allowlisted paths: exporter internals, graph exporter, prebuild guard, auto-map generator, and the composite API itself.\n",
  );
  for (const f of allFindings) {
    console.error(`${f.file}:${f.line}: ${f.text}`);
  }
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
