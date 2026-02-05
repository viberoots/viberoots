#!/usr/bin/env zx-wrapper
/**
 * build-tools/tools/dev/build-selected.ts
 *
 * Centralized helper to build a single Buck target via the Nix flake attr
 * graph-generator-selected. Prints ONLY the out path on stdout; all logs go to stderr.
 *
 * Inputs (via env):
 * - BUCK_TARGET: required label (e.g., //projects/apps/foo:foo)
 * - BUCK_GRAPH_JSON: optional path to build-tools/tools/buck/graph.json for the CURRENT workspace
 * - BUCK_TEST_SRC: optional path to current repo working tree (defaults to cwd)
 * - WORKSPACE_ROOT: optional working tree root (preferred when present in Buck actions)
 */
import * as fsp from "node:fs/promises";
import path from "node:path";
import { ensureGraph } from "../buck/glue-run.ts";
import { allDevOverrideEnvNames } from "../lib/dev-override-envs.ts";
import { getImporterRootsContract } from "../lib/importer-roots.ts";
import { sanitizeAttrNameFromLabel } from "../lib/labels.ts";
import { findRepoRoot, pathExists } from "../lib/repo.ts";

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");
}

async function main() {
  const target = (process.env.BUCK_TARGET || "").trim();
  if (!target) {
    console.error("BUCK_TARGET is required (e.g., //projects/apps/foo:foo)");
    process.exit(2);
  }
  const cwd = path.resolve(process.cwd());
  // This tool must always operate on the *current working tree*.
  //
  // In Buck tests, the parent process often has env vars like BUCK_TEST_SRC/WORKSPACE_ROOT pointing
  // at the developer checkout ("live repo"), but the test itself runs inside a temp repo (cwd=tmp).
  // Using those env vars here would silently target the wrong workspace and make builds flaky.
  const workspaceRoot = await findRepoRoot(cwd);
  if (!(await pathExists(path.join(workspaceRoot, "flake.nix")))) {
    console.error(`flake.nix not found at workspace root: ${workspaceRoot}`);
    process.exit(2);
  }

  // Ensure the graph exists via the canonical helper; preserve exporter env behavior
  const graphPath = path.join(workspaceRoot, "build-tools", "tools", "buck", "graph.json");
  // Prefer working tree as BUCK_TEST_SRC so exporter operates on the correct repo root
  const importerRoots = getImporterRootsContract().workspaceRoots;
  const defaultRoots = Array.from(new Set([...importerRoots, "go", "cpp", "third_party"])).join(
    ",",
  );
  const queryRoots =
    (process.env.BUCK_QUERY_ROOTS && String(process.env.BUCK_QUERY_ROOTS).trim()) || defaultRoots;
  process.env.BUCK_TEST_SRC = workspaceRoot;
  // ensureGraph prefers WORKSPACE_ROOT when set; force it to the chosen workDir so we don't
  // accidentally export a graph into the outer verify workspace when invoked from a temp repo.
  process.env.WORKSPACE_ROOT = workspaceRoot;
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
  process.env.BUCK_TEST_SRC = workspaceRoot;
  // Optional debug: surface a snippet of graph.json for diagnostics when requested
  if ((process.env.EXPORTER_DEBUG || "").trim() === "1") {
    try {
      const preview = await fsp.readFile(graphPath, "utf8");
      const head = preview.slice(0, 200).replace(/\s+/g, " ");
      console.error(`[build-selected][debug] graph.json head: ${head}`);
    } catch {}
  }

  console.error(`[build-selected] BUCK_TARGET=${target}`);
  const providedTargetAttr = (process.env.BUCK_TARGET_ATTR || "").trim();
  const cppTargetAttrSuffix = providedTargetAttr || sanitizeAttrNameFromLabel(target);
  console.error(`[build-selected] cppTargetAttrSuffix=${cppTargetAttrSuffix}`);

  // Sanitize impure dev-override env to avoid accidental JSON parse errors in planner
  const sanitizedEnv: Record<string, string> = {
    ...process.env,
    BUCK_TARGET: target,
  };
  for (const envName of allDevOverrideEnvNames()) {
    sanitizedEnv[envName] = "";
  }

  const nixTrace = (process.env.EXPORTER_DEBUG || "").trim() === "1" ? "--show-trace" : "";
  const { stdout, exitCode } = await $({
    env: sanitizedEnv,
    reject: false,
    nothrow: true,
  })`nix build --impure ${workspaceRoot}#graph-generator-selected --accept-flake-config --print-out-paths ${nixTrace}`;
  if (exitCode !== 0) {
    console.error(
      "[build-selected] nix build failed.\n" +
        "Ensure build-tools/tools/buck/graph.json includes the requested target and re-run glue export.",
    );
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
