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
import { runNodeWithZx } from "../lib/node-run.ts";
import { findRepoRoot, pathExists } from "../lib/repo.ts";
import { getArgvTokens } from "../lib/cli.ts";
import { untrackedRequiresImpureForTargets } from "./dev-build/untracked.ts";
import { makeFilteredFlakeRef } from "./filtered-flake.ts";
import { resolveSelectedTargetLabel } from "./target-label-resolver.ts";

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");
}

function targetPackageFromLabel(target: string): string {
  const t = String(target || "").trim();
  const noCell = t.startsWith("root//") ? t.slice("root//".length - 2) : t;
  if (!noCell.startsWith("//")) return "";
  const body = noCell.slice(2);
  const idx = body.indexOf(":");
  return idx >= 0 ? body.slice(0, idx) : body;
}

function parseSourceMode(argv: string[]): {
  sourceMode: "auto" | "git" | "path";
  sourceError?: string;
} {
  let sourceMode: "auto" | "git" | "path" = "auto";
  let sourceError: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const tok = String(argv[i] || "").trim();
    if (tok === "--source" && i + 1 < argv.length) {
      const s = String(argv[i + 1] || "").trim();
      if (s === "auto" || s === "git" || s === "path") sourceMode = s;
      else sourceError = `invalid --source value '${s}' (expected auto|git|path)`;
      i++;
      continue;
    }
    if (tok.startsWith("--source=")) {
      const s = tok.slice("--source=".length).trim();
      if (s === "auto" || s === "git" || s === "path") sourceMode = s;
      else sourceError = `invalid --source value '${s}' (expected auto|git|path)`;
      continue;
    }
  }
  return { sourceMode, sourceError };
}

async function chooseFlakeRef(opts: {
  workspaceRoot: string;
  target: string;
  sourceMode: "auto" | "git" | "path";
}): Promise<{ flakeRef: string; cleanup?: () => Promise<void> }> {
  if (opts.sourceMode === "path")
    return { flakeRef: `path:${opts.workspaceRoot}#graph-generator-selected` };
  if (opts.sourceMode === "git")
    return { flakeRef: `${opts.workspaceRoot}#graph-generator-selected` };
  try {
    const { stdout } = await $({
      stdio: "pipe",
      cwd: opts.workspaceRoot,
    })`git ls-files --others --exclude-standard`;
    const untracked = String(stdout || "")
      .trim()
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    if (untracked.length === 0)
      return { flakeRef: `${opts.workspaceRoot}#graph-generator-selected` };
    const targetPackages = [targetPackageFromLabel(opts.target)].filter(Boolean);
    const decision = untrackedRequiresImpureForTargets({ untracked, targetPackages });
    if (!decision.requiresImpure)
      return { flakeRef: `${opts.workspaceRoot}#graph-generator-selected` };
    console.error(
      "[build-selected] Falling back to path flake source due to relevant untracked files:",
    );
    for (const f of decision.relevant.slice(0, 50)) console.error(` - ${f}`);
    if (decision.relevant.length > 50) {
      console.error(` ... and ${decision.relevant.length - 50} more`);
    }
    const filtered = await makeFilteredFlakeRef({
      workspaceRoot: opts.workspaceRoot,
      attr: "graph-generator-selected",
      logPrefix: "[build-selected]",
    });
    return { flakeRef: filtered.flakeRef, cleanup: filtered.cleanup };
  } catch {
    return { flakeRef: `${opts.workspaceRoot}#graph-generator-selected` };
  }
}

async function main() {
  const parsedSource = parseSourceMode(getArgvTokens());
  if (parsedSource.sourceError) {
    console.error(`[build-selected] ${parsedSource.sourceError}`);
    process.exit(2);
  }
  const targetRaw = (process.env.BUCK_TARGET || "").trim();
  if (!targetRaw) {
    console.error("BUCK_TARGET is required (e.g., //projects/apps/foo:foo)");
    console.error("optional: --source=auto|git|path");
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
  const target = await resolveSelectedTargetLabel(workspaceRoot, targetRaw, { baseDir: cwd });

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
  await runNodeWithZx({
    cwd: workspaceRoot,
    zxInitPath: path.join(workspaceRoot, "build-tools", "tools", "dev", "zx-init.mjs"),
    script: path.join(
      workspaceRoot,
      "build-tools",
      "tools",
      "buck",
      "enforce-node-patch-requirements.ts",
    ),
    args: ["--check"],
    stdio: "inherit",
  });
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

  const flakeSource = await chooseFlakeRef({
    workspaceRoot,
    target,
    sourceMode: parsedSource.sourceMode,
  });
  const nixTrace = (process.env.EXPORTER_DEBUG || "").trim() === "1" ? "--show-trace" : "";
  const { stdout, exitCode } = await (async () => {
    try {
      return await $({
        env: sanitizedEnv,
        reject: false,
        nothrow: true,
      })`nix build --impure --no-write-lock-file --option eval-cache false ${flakeSource.flakeRef} --accept-flake-config --print-out-paths ${nixTrace}`;
    } finally {
      await flakeSource.cleanup?.();
    }
  })();
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
