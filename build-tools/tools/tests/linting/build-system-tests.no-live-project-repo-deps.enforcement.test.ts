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

const DIRECT_PROJECT_FS_ACCESS_RE =
  /\b(?:readFile|readFileSync|copyFile|copyFileSync|cp|cpSync|stat|statSync|lstat|lstatSync|access|accessSync|readdir|readdirSync|opendir|opendirSync)\(\s*["'`]projects\//g;

function normalizeRelPath(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineNumberForOffset(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function repoRootAliases(text: string): string[] {
  const aliases = new Set<string>(["process.cwd()"]);
  const aliasRe =
    /\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:process\.cwd\(\)|repoRoot\(\)|process\.env\.REPO_ROOT\s*(?:\|\||\?\?)\s*process\.cwd\(\))/g;

  for (const match of text.matchAll(aliasRe)) {
    const alias = String(match[1] || "").trim();
    if (alias) aliases.add(alias);
  }

  return Array.from(aliases).sort((a, b) => a.localeCompare(b));
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
      if (entry.name.endsWith(".ts")) out.push(abs);
    }
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}

test("build-system tests do not depend on live repo projects/ contents", async () => {
  const repoRoot = process.cwd();
  const files = await listTestFiles(repoRoot);
  const hits: Array<{ file: string; line: number; message: string }> = [];

  for (const abs of files) {
    const rel = normalizeRelPath(path.relative(repoRoot, abs));
    const text = await fsp.readFile(abs, "utf8");

    for (const match of text.matchAll(DIRECT_PROJECT_FS_ACCESS_RE)) {
      const offset = match.index ?? 0;
      hits.push({
        file: rel,
        line: lineNumberForOffset(text, offset),
        message:
          "direct filesystem access to relative projects/... is not allowed in build-system tests; use path.join(tmp, ...) in a temp repo or move shared fixtures/macros into build-tools/",
      });
    }

    for (const alias of repoRootAliases(text)) {
      const aliasExpr = alias === "process.cwd()" ? "process\\.cwd\\(\\)" : escapeRegex(alias);
      const fromRepoProjectsRe = new RegExp(
        String.raw`path\.(?:join|resolve)\(\s*${aliasExpr}\s*,\s*["'\`]projects(?:/|["'\`])`,
        "g",
      );
      const templateProjectsRe = new RegExp(String.raw`\$\{\s*${aliasExpr}\s*\}/projects/`, "g");

      for (const re of [fromRepoProjectsRe, templateProjectsRe]) {
        for (const match of text.matchAll(re)) {
          const offset = match.index ?? 0;
          hits.push({
            file: rel,
            line: lineNumberForOffset(text, offset),
            message:
              "build-system tests must not construct live repo projects/... paths from process.cwd()/repo root; use a temp repo path or keep shared build-system fixtures under build-tools/",
          });
        }
      }
    }
  }

  if (hits.length > 0) {
    const details = hits
      .slice(0, 50)
      .map((hit) => `- ${hit.file}:${hit.line} ${hit.message}`)
      .join("\n");
    const tail = hits.length > 50 ? `\n... and ${hits.length - 50} more` : "";
    throw new Error(
      [
        "Found build-system tests that depend on live repo projects/ contents.",
        "Build-system tests must materialize project files inside temp repos or load shared fixtures from build-tools/ instead.",
        "",
        details + tail,
      ].join("\n"),
    );
  }
});
