#!/usr/bin/env zx-wrapper
/**
 * lint-global-stamping.ts — PR‑5 guard
 * Fails if any .bzl macro files directly stamp //.viberoots/workspace:flake.lock
 * outside the centralized helper allowlist.
 */
import * as fsp from "node:fs/promises";
import path from "node:path";

type Violation = { file: string; line: number; text: string };

function repoPath(p: string): string {
  return p.split(path.sep).join("/");
}

async function listBzlFiles(): Promise<string[]> {
  // Prefer git to respect .gitignore and avoid vendor/third_party noise
  const out = await $`git ls-files '*.bzl'`.nothrow();
  const txt = String(out.stdout || "").trim();
  return txt
    ? txt
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

async function fileContainsDirectStamp(file: string): Promise<Violation[]> {
  let data = "";
  try {
    data = await fsp.readFile(file, "utf8");
  } catch (e: any) {
    // Robust on working trees with deletions (e.g., refactors in-flight):
    // `git ls-files` may still list paths that no longer exist.
    if (e && typeof e === "object" && (e as any).code === "ENOENT") return [];
    throw e;
  }
  const lines = data.split(/\r?\n/);
  const viols: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("//.viberoots/workspace:flake.lock")) {
      viols.push({ file, line: i + 1, text: line.trim() });
    }
  }
  return viols;
}

async function main() {
  const allowlist = new Set<string>([
    "build-tools/lang/global_inputs.bzl", // centralized policy (PR‑5)
  ]);
  const files = await listBzlFiles();
  const viols: Violation[] = [];
  for (const f of files) {
    const rel = repoPath(f);
    if (allowlist.has(rel)) continue;
    const vs = await fileContainsDirectStamp(rel);
    if (vs.length > 0) {
      // Exempt the canonical auto_map load or comments by narrowing matches:
      // We treat any occurrence as a violation for clarity.
      viols.push(...vs);
    }
  }
  if (viols.length > 0) {
    console.error(
      "[lint-global-stamping] Direct //.viberoots/workspace:flake.lock stamping found in:",
    );
    for (const v of viols) {
      console.error(`  ${v.file}:${v.line}: ${v.text}`);
    }
    process.exit(2);
  }
  console.log("lint-global-stamping: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
