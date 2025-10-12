#!/usr/bin/env zx-wrapper
/**
 * tools/dev/build-selected.ts
 *
 * Centralized helper to build a single Buck target via the Nix flake attr
 * graph-generator-selected. Prints ONLY the out path on stdout; all logs go to stderr.
 *
 * Inputs (via env):
 * - BUCK_TARGET: required label (e.g., //apps/foo:foo)
 * - BUCK_GRAPH_JSON: optional path to tools/buck/graph.json for the CURRENT workspace
 * - BUCK_TEST_SRC: optional path to current repo working tree (defaults to cwd)
 */
import fs from "fs-extra";
import path from "node:path";

async function findRepoRoot(start: string): Promise<string> {
  let dir = path.resolve(start);
  for (;;) {
    if (await fs.pathExists(path.join(dir, "flake.nix"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback to git root if available; otherwise use start
  try {
    const { stdout } = await $`git -C ${start} rev-parse --show-toplevel`;
    const p = String(stdout || "").trim();
    if (p) return p;
  } catch {}
  return path.resolve(start);
}

async function ensureGraph(repoRoot: string, workDir: string) {
  const graphRel = path.join("tools", "buck", "graph.json");
  const graphPath = process.env.BUCK_GRAPH_JSON || path.join(workDir, graphRel);
  const outDir = path.dirname(graphPath);
  await fs.ensureDir(outDir);
  if (await fs.pathExists(graphPath)) {
    console.error(`[build-selected] using existing graph: ${graphPath}`);
    return graphPath;
  }
  console.error(`[build-selected] exporting graph to ${graphPath}`);
  await $`nix run ${repoRoot}#zx-wrapper -- ${path.join(repoRoot, "tools/buck/export-graph.ts")} --out ${graphPath}`;
  return graphPath;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");
}

async function main() {
  const target = (process.env.BUCK_TARGET || "").trim();
  if (!target) {
    console.error("BUCK_TARGET is required (e.g., //apps/foo:foo)");
    process.exit(2);
  }
  const workDir = path.resolve(process.env.BUCK_TEST_SRC || process.cwd());
  const repoRoot = await findRepoRoot(workDir);
  if (!(await fs.pathExists(path.join(repoRoot, "flake.nix")))) {
    console.error("flake.nix not found at repo root");
    process.exit(2);
  }

  const graphPath = await ensureGraph(repoRoot, workDir);
  process.env.BUCK_GRAPH_JSON = graphPath;
  process.env.BUCK_TEST_SRC = workDir;

  console.error(`[build-selected] BUCK_TARGET=${target}`);
  const { stdout, exitCode } = await $({
    env: { ...process.env, BUCK_TARGET: target },
    reject: false,
    nothrow: true,
  })`nix build --impure ${repoRoot}#graph-generator-selected --accept-flake-config --print-out-paths`;
  if (exitCode !== 0) {
    console.error("nix build failed with code", exitCode);
    process.exit(exitCode || 1);
  }
  const lines = stripAnsi(String(stdout || ""))
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const outPath = lines[lines.length - 1] || "";
  if (!outPath) {
    console.error("no out path emitted by nix build");
    process.exit(2);
  }
  // Print ONLY the out path on stdout
  process.stdout.write(outPath + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
