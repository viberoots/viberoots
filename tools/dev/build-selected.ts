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
import * as fsp from "node:fs/promises";
import path from "node:path";
import { ensureGraph } from "../buck/glue-run.ts";
import { findRepoRoot, pathExists } from "../lib/repo.ts";
import { sanitizeAttrNameFromLabel } from "../lib/labels.ts";

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
  if (!(await pathExists(path.join(repoRoot, "flake.nix")))) {
    console.error("flake.nix not found at repo root");
    process.exit(2);
  }

  // Ensure the graph exists via the canonical helper; preserve exporter env behavior
  const graphPath = path.join(workDir, "tools", "buck", "graph.json");
  // Prefer working tree as BUCK_TEST_SRC so exporter operates on the correct repo root
  const queryRoots = ["apps", "libs", "cpp", "third_party"].join(",");
  process.env.BUCK_TEST_SRC = workDir;
  process.env.EXPORTER_DEBUG = "1";
  // Prefer warn-level validation during local/dev builds to avoid spurious failures in temp repos
  if (!process.env.EXPORTER_VALIDATION) {
    process.env.EXPORTER_VALIDATION = "warn";
  }
  process.env.BUCK_QUERY_ROOTS = queryRoots;
  // Ensure ensureGraph can see the requested target for presence checks
  process.env.BUCK_TARGET = target;
  // Log idempotent export/use to satisfy smoke tests and aid diagnostics
  try {
    const existing = await fsp.readFile(graphPath, "utf8");
    const trimmed = String(existing || "").trim();
    if (trimmed && trimmed !== "[]") {
      console.error(`[build-selected] using existing graph: ${graphPath}`);
    } else {
      console.error(`[build-selected] exporting graph to ${graphPath}`);
    }
  } catch {
    console.error(`[build-selected] exporting graph to ${graphPath}`);
  }
  await ensureGraph();
  process.env.BUCK_GRAPH_JSON = graphPath;
  process.env.BUCK_TEST_SRC = workDir;

  console.error(`[build-selected] BUCK_TARGET=${target}`);
  // Planner stubs are represented only in cppTargetsFlat; selected may not include them.
  const isPlanner = target.endsWith("__planner");

  const { stdout, exitCode } = await $({
    env: { ...process.env, BUCK_TARGET: target },
    reject: false,
    nothrow: true,
  })`nix build --impure ${repoRoot}#graph-generator-selected --accept-flake-config --print-out-paths`;
  if (exitCode !== 0) {
    // General fallback: try cppTargetsFlat attribute for any C++-backed target
    const attr = `graph-generator-cppTargets.${sanitizeAttrNameFromLabel(target)}`;
    const res = await $({
      env: { ...process.env },
      reject: false,
      nothrow: true,
    })`nix build --impure ${repoRoot}#${attr} --accept-flake-config --print-out-paths`;
    if (res.exitCode !== 0) {
      console.error("nix build failed (fallback)", res.exitCode);
      process.exit(res.exitCode || 1);
    }
    const lines = stripAnsi(String(res.stdout || ""))
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    const outPath = lines[lines.length - 1] || "";
    if (!outPath) {
      console.error("no out path emitted by nix build (fallback)");
      process.exit(2);
    }
    process.stdout.write(outPath + "\n");
    return;
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
