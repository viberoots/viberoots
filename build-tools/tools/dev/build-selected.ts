#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runNixBuildWithTransientRetry } from "./build-selected-nix-retry";
import { ensureGraph } from "../buck/glue-run";
import { getImporterRootsContract } from "../lib/importer-roots";
import { sanitizeAttrNameFromLabel } from "../lib/labels";
import { runNodeWithZx } from "../lib/node-run";
import { findRepoRoot, pathExists } from "../lib/repo";
import { getArgvTokens } from "../lib/cli";
import { runMain } from "../lib/cli-wrap";
import { withScopedEnv } from "../lib/scoped-env";
import { inspectArtifactSource } from "../lib/artifact-source-inventory";
import { targetPackageFromLabel } from "./build-selected-helpers";
import { parseSelectedBuildOutPath, selectedNixBuildArgs } from "./build-selected-nix-command";
import { makeFilteredFlakeRef } from "./filtered-flake";
import { resolveFinalPnpmStore } from "./update-pnpm-hash/realized-store";
import { pnpmStoreAttrFromImporter } from "./update-pnpm-hash/paths";
import { withSanitizedInheritedNixConfig } from "../lib/nix-config-env";
import { resolveSelectedTargetLabel } from "./target-label-resolver";
import { buildToolPath, zxInitPath } from "./dev-build/paths";
import { classifyArtifactBuild } from "../lib/artifact-build-policy";
import { resolveToolPathSync } from "../lib/tool-paths";
import { withoutEvaluationSelectors } from "./evaluation-bundle-env";
import { evaluationBundleHasLanguageOverrides } from "./evaluation-bundle-selectors";
import {
  emitArtifactPolicyEvidence,
  inspectArtifactBuildPolicy,
} from "./artifact-policy-inspection";

async function runCommand(opts: {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const proc = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env || process.env,
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    proc.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    proc.on("error", reject);
    proc.on("exit", (code, signal) => {
      const exitCode = code ?? 1;
      if (exitCode === 0 || opts.allowFailure) {
        resolve({ exitCode, stdout, stderr });
        return;
      }
      const suffix = signal ? ` (signal ${signal})` : "";
      const details = [stderr, stdout]
        .map((value) => value.trim())
        .filter(Boolean)
        .join("\n");
      reject(
        Object.assign(
          new Error(
            `${path.basename(opts.command)} exited with code ${exitCode}${suffix}${
              details ? `\n${details}` : ""
            }`,
          ),
          { exitCode, stdout, stderr },
        ),
      );
    });
  });
}

async function workspaceFlakeDir(workspaceRoot: string): Promise<string> {
  const hidden = path.join(workspaceRoot, ".viberoots", "workspace");
  if (await pathExists(path.join(hidden, "flake.nix"))) return hidden;
  if (await pathExists(path.join(workspaceRoot, "flake.nix"))) return workspaceRoot;
  return "";
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
  graphPath: string;
}): Promise<{
  flakeRef: string;
  workspaceRoot?: string;
  cleanup?: () => Promise<void>;
  localDevelopment?: boolean;
}> {
  const workspaceAbs = path.resolve(opts.workspaceRoot);
  const isLikelyTempWorkspace =
    workspaceAbs.startsWith("/tmp/") ||
    workspaceAbs.startsWith("/private/tmp/") ||
    workspaceAbs.startsWith("/private/var/folders/") ||
    workspaceAbs.includes(`${path.sep}viberoots-verify-`) ||
    workspaceAbs.includes(`${path.sep}buck-out${path.sep}tmp${path.sep}tmpdir${path.sep}`);
  const targetPackages = [targetPackageFromLabel(opts.target)].filter(Boolean);
  const inventory = await inspectArtifactSource({
    targetPackages,
    runGit: async () =>
      await runCommand({
        command: resolveToolPathSync("git"),
        args: ["ls-files", "-z", "--others", "--exclude-standard"],
        cwd: opts.workspaceRoot,
        allowFailure: true,
      }),
  });
  const localDevelopment =
    opts.sourceMode === "path" ||
    isLikelyTempWorkspace ||
    inventory.localDevelopment ||
    evaluationBundleHasLanguageOverrides(process.env);
  if (inventory.localDevelopment && opts.sourceMode === "auto") {
    console.error(
      "[build-selected] bundling relevant untracked files as local development source:",
    );
    for (const file of inventory.relevant.slice(0, 50)) console.error(` - ${file}`);
  }
  const filtered = await makeFilteredFlakeRef({
    workspaceRoot: opts.workspaceRoot,
    attr: "graph-generator-selected",
    logPrefix: "[build-selected]",
    graphPath: opts.graphPath,
    target: opts.target,
    classification: localDevelopment ? "local-development" : "hermetic",
  });
  return {
    flakeRef: filtered.flakeRef,
    workspaceRoot: filtered.workspaceRoot,
    cleanup: filtered.cleanup,
    localDevelopment,
  };
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
    envWorkspace && (await workspaceFlakeDir(envWorkspace))
      ? path.resolve(envWorkspace)
      : await findRepoRoot(cwd);
  if (!(await workspaceFlakeDir(workspaceRoot))) {
    console.error(
      `workspace flake not found at ${workspaceRoot}/.viberoots/workspace/flake.nix or ${workspaceRoot}/flake.nix`,
    );
    process.exit(2);
  }
  const target = await resolveSelectedTargetLabel(workspaceRoot, targetRaw, { baseDir: cwd });
  const graphPath = path.join(
    workspaceRoot,
    ".viberoots",
    "workspace",
    "buck",
    "selected",
    `${sanitizeAttrNameFromLabel(target)}.graph.json`,
  );
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
      await ensureGraph({ workspaceRoot, target, graphPath });
    },
  );
  await runNodeWithZx({
    cwd: workspaceRoot,
    zxInitPath: zxInitPath(workspaceRoot),
    script: buildToolPath(workspaceRoot, "tools/buck/enforce-node-patch-requirements.ts"),
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
  const sanitizedEnv = withoutEvaluationSelectors(
    withSanitizedInheritedNixConfig({
      ...process.env,
      BUCK_QUERY_ROOTS: queryRoots,
      EXPORTER_VALIDATION: validation,
      EXPORTER_DEBUG: exporterDebug,
    }),
  );
  const flakeSource = await chooseFlakeRef({
    workspaceRoot,
    target,
    sourceMode: parsedSource.sourceMode,
    graphPath,
  });
  const flakeEnv = flakeSource.workspaceRoot
    ? {
        ...sanitizedEnv,
        VBR_PNPM_FILTERED_SNAPSHOT_ROOT: flakeSource.workspaceRoot,
        VBR_FILTERED_FLAKE_SNAPSHOT: "1",
      }
    : sanitizedEnv;
  const policyEvidence = await inspectArtifactBuildPolicy({
    classification: classifyArtifactBuild({
      diagnosticImpure: false,
      localDevelopment: Boolean(flakeSource.localDevelopment),
    }),
    impureEvaluation: false,
    env: flakeEnv,
    toolPaths: { node: process.execPath },
    toolNames: ["git"],
    runCommand: async (command, args) =>
      await runCommand({ command, args, env: flakeEnv, allowFailure: true }),
  });
  emitArtifactPolicyEvidence(policyEvidence);
  const targetImporter = targetPackageFromLabel(target);
  let fixedStore: Awaited<ReturnType<typeof resolveFinalPnpmStore>> | null = null;
  let attempt: any;
  try {
    fixedStore =
      targetImporter &&
      (await pathExists(path.join(workspaceRoot, targetImporter, "pnpm-lock.yaml")))
        ? await resolveFinalPnpmStore({
            repoRoot: workspaceRoot,
            importer: targetImporter,
            flakeRef: flakeSource.flakeRef,
            attrPath: pnpmStoreAttrFromImporter(targetImporter),
            env: flakeEnv,
          })
        : null;
    const nixTrace = exporterDebug === "1" ? "--show-trace" : "";
    const runOnce = async () => {
      const args = selectedNixBuildArgs({
        flakeRef: flakeSource.flakeRef,
        showTrace: Boolean(nixTrace),
      });
      const command = args[0] || "nix";
      return await runCommand({
        command,
        args: args.slice(1),
        env: flakeEnv,
        allowFailure: true,
      });
    };
    attempt = await runNixBuildWithTransientRetry({ runOnce });
  } finally {
    await fixedStore?.cleanup();
    await flakeSource.cleanup?.();
  }
  const { stdout, stderr, exitCode } = attempt;
  if (exitCode !== 0) {
    const detail = [stderr, stdout]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join("\n");
    console.error(
      "[build-selected] nix build failed.\n" +
        (detail ? `${detail}\n` : "") +
        `Ensure ${graphPath} includes the requested target and re-run glue export.`,
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

runMain(main);
