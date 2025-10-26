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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true });
}

async function findRepoRoot(start: string): Promise<string> {
  let dir = path.resolve(start);
  for (;;) {
    if (await pathExists(path.join(dir, "flake.nix"))) return dir;
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
  await ensureDir(outDir);
  if (await pathExists(graphPath)) {
    try {
      const txt = await fsp.readFile(graphPath, "utf8");
      const trimmed = txt.trim();
      if (trimmed && trimmed !== "[]") {
        console.error(`[build-selected] using existing graph: ${graphPath}`);
        return graphPath;
      }
      console.error(`[build-selected] existing graph empty; regenerating: ${graphPath}`);
    } catch {}
  } else {
    console.error(`[build-selected] exporting graph to ${graphPath}`);
  }
  // Limit exporter query roots to the target's package to avoid unrelated package errors.
  const target = (process.env.BUCK_TARGET || "").trim();
  const dropCellAndConfig = (label: string) => {
    const noCfg = label.split(" (config//")[0];
    if (noCfg.includes("//") && !noCfg.startsWith("//")) {
      const idx = noCfg.indexOf("//");
      return "//" + noCfg.slice(idx + 2);
    }
    return noCfg;
  };
  const pkgOf = (label: string) => {
    const base = dropCellAndConfig(label);
    const left = base.split(":")[0];
    return left.startsWith("//") ? left.slice(2) : left;
  };
  const pkg = target ? pkgOf(target) : "";
  const queryRoots = [pkg, "cpp"].filter(Boolean).join(",");
  await $({
    env: {
      ...process.env,
      BUCK_TEST_SRC: workDir,
      EXPORTER_DEBUG: "1",
      BUCK_QUERY_ROOTS: queryRoots,
    },
  })`nix run ${repoRoot}#zx-wrapper -- ${path.join(repoRoot, "tools/buck/export-graph.ts")} --out ${graphPath}`;
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
  if (!(await pathExists(path.join(repoRoot, "flake.nix")))) {
    console.error("flake.nix not found at repo root");
    process.exit(2);
  }

  const graphPath = await ensureGraph(repoRoot, workDir);
  process.env.BUCK_GRAPH_JSON = graphPath;
  process.env.BUCK_TEST_SRC = workDir;

  console.error(`[build-selected] BUCK_TARGET=${target}`);
  // Planner stubs are represented only in cppTargetsFlat; selected may not include them.
  const isPlanner = target.endsWith("__planner");
  function dropCellAndConfig(label: string): string {
    const noCfg = label.split(" (config//")[0];
    if (noCfg.includes("//") && !noCfg.startsWith("//")) {
      const idx = noCfg.indexOf("//");
      return "//" + noCfg.slice(idx + 2);
    }
    return noCfg;
  }
  function sanitizeAttrName(label: string): string {
    const s = dropCellAndConfig(label).toLowerCase();
    // Map any non [a-z0-9_] to underscore and prefix with 't'
    return "t" + s.replace(/[^a-z0-9_]/g, "_");
  }

  const { stdout, exitCode } = await $({
    env: { ...process.env, BUCK_TARGET: target },
    reject: false,
    nothrow: true,
  })`nix build --impure ${repoRoot}#graph-generator-selected --accept-flake-config --print-out-paths`;
  if (exitCode !== 0) {
    if (isPlanner) {
      // Fallback to cppTargetsFlat for planner/test labels
      const attr = `graph-generator-cppTargets.${sanitizeAttrName(target)}`;
      const res = await $({
        env: { ...process.env },
        reject: false,
        nothrow: true,
      })`nix build --impure ${repoRoot}#${attr} --accept-flake-config --print-out-paths`;
      if (res.exitCode !== 0) {
        console.error("nix build failed (planner fallback)", res.exitCode);
        process.exit(res.exitCode || 1);
      }
      const lines = stripAnsi(String(res.stdout || ""))
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      const outPath = lines[lines.length - 1] || "";
      if (!outPath) {
        console.error("no out path emitted by nix build (planner fallback)");
        process.exit(2);
      }
      process.stdout.write(outPath + "\n");
      return;
    }
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
