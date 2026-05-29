#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runNixBuildWithTransientRetry } from "./build-selected-nix-retry";
import { ensureGraph } from "../buck/glue-run";
import { allDevOverrideEnvNames } from "../lib/dev-override-envs";
import { getImporterRootsContract } from "../lib/importer-roots";
import { sanitizeAttrNameFromLabel } from "../lib/labels";
import { runNodeWithZx } from "../lib/node-run";
import { findRepoRoot, pathExists } from "../lib/repo";
import { getArgvTokens } from "../lib/cli";
import { withScopedEnv } from "../lib/scoped-env";
import { untrackedRequiresImpureForTargets } from "./dev-build/untracked";
import { targetPackageFromLabel } from "./build-selected-helpers";
import { parseSelectedBuildOutPath, selectedNixBuildArgs } from "./build-selected-nix-command";
import { makeFilteredFlakeRef } from "./filtered-flake";
import { resolveSelectedTargetLabel } from "./target-label-resolver";
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
  const repoRootEnv = String(process.env.REPO_ROOT || "").trim();
  const workspaceAbs = path.resolve(opts.workspaceRoot);
  const isLikelyTempWorkspace =
    workspaceAbs.startsWith("/tmp/") ||
    workspaceAbs.startsWith("/private/tmp/") ||
    workspaceAbs.startsWith("/private/var/folders/") ||
    workspaceAbs.includes(`${path.sep}buck-out${path.sep}tmp${path.sep}tmpdir${path.sep}`);
  if (opts.sourceMode === "auto" && isLikelyTempWorkspace) {
    const filtered = await makeFilteredFlakeRef({
      workspaceRoot: opts.workspaceRoot,
      attr: "graph-generator-selected",
      logPrefix: "[build-selected]",
    });
    return filtered;
  }
  if (opts.sourceMode === "auto" && repoRootEnv) {
    const repoRootAbs = path.resolve(repoRootEnv);
    if (repoRootAbs !== workspaceAbs) {
      return { flakeRef: `path:${workspaceAbs}#graph-generator-selected` };
    }
  }
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
  const envWorkspace = String(process.env.WORKSPACE_ROOT || process.env.BUCK_TEST_SRC || "").trim();
  const workspaceRoot =
    envWorkspace && (await pathExists(path.join(envWorkspace, "flake.nix")))
      ? path.resolve(envWorkspace)
      : await findRepoRoot(cwd);
  if (!(await pathExists(path.join(workspaceRoot, "flake.nix")))) {
    console.error(`flake.nix not found at workspace root: ${workspaceRoot}`);
    process.exit(2);
  }
  const target = await resolveSelectedTargetLabel(workspaceRoot, targetRaw, { baseDir: cwd });
  const graphPath = path.join(workspaceRoot, "build-tools", "tools", "buck", "graph.json");
  const importerRoots = getImporterRootsContract().workspaceRoots;
  const defaultRoots = Array.from(new Set([...importerRoots, "go", "cpp", "third_party"])).join(
    ",",
  );
  const queryRoots =
    (process.env.BUCK_QUERY_ROOTS && String(process.env.BUCK_QUERY_ROOTS).trim()) || defaultRoots;
  const exporterDebug = (process.env.EXPORTER_DEBUG || "").trim();
  const validation = (process.env.EXPORTER_VALIDATION || "").trim() || "warn";
  await withScopedEnv(
    {
      BUCK_TEST_SRC: workspaceRoot,
      WORKSPACE_ROOT: workspaceRoot,
      EXPORTER_DEBUG: exporterDebug,
      EXPORTER_VALIDATION: validation,
      BUCK_QUERY_ROOTS: queryRoots,
      BUCK_TARGET: target,
      BUCK_GRAPH_JSON: graphPath,
    },
    async () => {
      try {
        const existing = await fsp.readFile(graphPath, "utf8");
        const trimmed = String(existing || "").trim();
        if (trimmed && trimmed !== "[]")
          console.error(`[build-selected] using existing graph: ${graphPath}`);
        else console.error(`[build-selected] exporting graph to ${graphPath}`);
      } catch {
        console.error(`[build-selected] exporting graph to ${graphPath}`);
      }
      await ensureGraph();
    },
  );
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
  if (exporterDebug === "1") {
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
  const sanitizedEnv: Record<string, string> = {
    ...process.env,
    BUCK_TARGET: target,
    WORKSPACE_ROOT: workspaceRoot,
    BUCK_TEST_SRC: workspaceRoot,
    BUCK_GRAPH_JSON: graphPath,
    BUCK_QUERY_ROOTS: queryRoots,
    EXPORTER_VALIDATION: validation,
    EXPORTER_DEBUG: exporterDebug,
  };
  for (const envName of allDevOverrideEnvNames()) {
    sanitizedEnv[envName] = "";
  }

  const flakeSource = await chooseFlakeRef({
    workspaceRoot,
    target,
    sourceMode: parsedSource.sourceMode,
  });
  const nixTrace = exporterDebug === "1" ? "--show-trace" : "";
  const runOnce = async () => {
    return await $({
      env: sanitizedEnv,
      reject: false,
      nothrow: true,
    })`${selectedNixBuildArgs({ flakeRef: flakeSource.flakeRef, showTrace: Boolean(nixTrace) })}`;
  };
  let attempt: any;
  try {
    attempt = await runNixBuildWithTransientRetry({ runOnce });
  } finally {
    await flakeSource.cleanup?.();
  }
  const { stdout, exitCode } = attempt;
  if (exitCode !== 0) {
    console.error(
      "[build-selected] nix build failed.\n" +
        "Ensure build-tools/tools/buck/graph.json includes the requested target and re-run glue export.",
    );
    process.exit(exitCode || 1);
  }
  let outPath = "";
  try {
    outPath = parseSelectedBuildOutPath(String(stdout || ""));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "invalid selected build out path");
    process.exit(2);
  }
  process.stdout.write(outPath + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
