#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

type Violation = {
  file: string;
  excerpt: string;
};

async function listTestFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (
        ent.name === "node_modules" ||
        ent.name === "buck-out" ||
        ent.name === "coverage" ||
        ent.name === ".git" ||
        ent.name === ".direnv"
      ) {
        continue;
      }
      out.push(...(await listTestFiles(p)));
      continue;
    }
    if (!ent.isFile()) continue;
    if (!p.endsWith(".test.ts")) continue;
    out.push(p);
  }
  return out;
}

type Span = { start: number; endExclusive: number };

function extractTemplateLiteralAt(src: string, startTick: number): Span | null {
  // Parse a JS template literal starting at `startTick`, handling nested `${ ... }` interpolations.
  // This is intentionally minimal but covers our common patterns, including nested template literals
  // inside interpolations (e.g. `${`path:${tmp}#attr`}`).
  if (src[startTick] !== "`") return null;
  let i = startTick + 1;
  let braceDepth = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (braceDepth === 0 && ch === "`") {
      return { start: startTick, endExclusive: i + 1 };
    }
    if (ch === "$" && src[i + 1] === "{") {
      braceDepth += 1;
      i += 2;
      continue;
    }
    if (braceDepth > 0) {
      if (ch === "{") {
        braceDepth += 1;
        i += 1;
        continue;
      }
      if (ch === "}") {
        braceDepth -= 1;
        i += 1;
        continue;
      }
    }
    i += 1;
  }
  return null;
}

function excerptAroundNeedle(haystack: string, needle: string): string {
  const idx = haystack.indexOf(needle);
  if (idx < 0) return haystack.slice(0, 180);
  const start = Math.max(0, idx - 80);
  const end = Math.min(haystack.length, idx + 160);
  return haystack.slice(start, end).replaceAll("\n", "\\n").replace(/\s+/g, " ").trim();
}

function findNixBuildCommandTemplates(src: string): string[] {
  const out: string[] = [];
  let idx = 0;
  while (true) {
    const startTick = src.indexOf("`nix build ", idx);
    if (startTick < 0) return out;
    // Heuristic: ignore backticks that appear inside JS string literals (e.g. "`${...}`") or other
    // non-command contexts. We intentionally keep this simple and focused on our zx command shapes.
    {
      let j = startTick - 1;
      while (j >= 0 && /\s/.test(src[j]!)) j -= 1;
      const prev = j >= 0 ? src[j]! : "";
      if (prev === '"' || prev === "'" || prev === "\\" || prev === "`") {
        idx = startTick + 1;
        continue;
      }
      // Ensure this looks like a command template (not an error message like `nix build failed:`).
      let k = startTick + "`nix build ".length;
      while (k < src.length && src[k] === " ") k += 1;
      const next = k < src.length ? src[k]! : "";
      const allowedNext = new Set(["-", ".", "/", "$", '"', "'", "p"]);
      if (!allowedNext.has(next)) {
        idx = startTick + 1;
        continue;
      }
    }
    const span = extractTemplateLiteralAt(src, startTick);
    if (span) {
      out.push(src.slice(span.start, span.endExclusive));
      idx = span.endExclusive;
    } else {
      idx = startTick + 1;
    }
  }
}

test("policy: tests must use `nix build --no-link` (no out-links / no accidental GC roots)", async () => {
  const root = path.join(process.cwd(), "tools", "tests");
  const files = await listTestFiles(root);
  const violations: Violation[] = [];

  for (const file of files) {
    const src = await fsp.readFile(file, "utf8");
    if (!src.includes("nix build")) continue;

    for (const lit of findNixBuildCommandTemplates(src)) {
      if (lit.includes("--no-link")) continue;

      violations.push({
        file: path.relative(process.cwd(), file),
        excerpt: excerptAroundNeedle(lit, "nix build"),
      });
    }
  }

  if (violations.length > 0) {
    const details = violations.map((v) => `- ${v.file}: ${v.excerpt}`).join("\n");
    throw new Error(
      [
        "Found test `nix build` invocations without `--no-link`.",
        "Policy: tests must use `nix build --no-link --print-out-paths` (or `--print-build-logs`) to avoid creating out-links that become GC roots.",
        "",
        details,
      ].join("\n"),
    );
  }
});
