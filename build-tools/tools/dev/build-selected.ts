#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runNixBuildWithTransientRetry } from "./build-selected-nix-retry";
import { materializeSelectedGraph } from "../buck/glue-run";
import { artifactGraphQueryRoots } from "../buck/artifact-graph-query-roots";
import { sanitizeAttrNameFromLabel } from "../lib/labels";
import { runNodeWithZx } from "../lib/node-run";
import { findRepoRoot, pathExists } from "../lib/repo";
import { getArgvTokens, getFlagBool, getFlagStr } from "../lib/cli";
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
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import { withoutEvaluationSelectors } from "./evaluation-bundle-env";
import {
  evaluationBundleDevOverrides,
  evaluationBundleHasLanguageOverrides,
  type DevOverrideValues,
} from "./evaluation-bundle-selectors";
import {
  emitArtifactPolicyEvidence,
  inspectArtifactBuildPolicy,
} from "./artifact-policy-inspection";
import { enterCanonicalArtifactEntrypoint } from "./canonical-artifact-entrypoint";
import {
  assertNoArtifactSelectorInjection,
  buildArtifactEnvironment,
  withoutArtifactEnvironmentInfluence,
} from "../lib/artifact-environment";
import {
  assertArtifactCommandSucceeded,
  runBoundedArtifactCommand,
} from "../lib/artifact-command-runner";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";

async function runCommand(opts: {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await runBoundedArtifactCommand({
    command: opts.command,
    args: opts.args,
    cwd: opts.cwd,
    env: opts.env || process.env,
  });
  if (!opts.allowFailure || result.timedOut || result.interrupted) {
    assertArtifactCommandSucceeded(path.basename(opts.command), result);
  }
  return result;
}

async function workspaceFlakeDir(workspaceRoot: string): Promise<string> {
  const hidden = path.join(workspaceRoot, ".viberoots", "workspace");
  if (await pathExists(path.join(hidden, "flake.nix"))) return hidden;
  if (await pathExists(path.join(workspaceRoot, "flake.nix"))) return workspaceRoot;
  return "";
}

function parseSourceMode(argv: string[]): {
  sourceMode: "auto" | "git" | "path";
  attr: "graph-generator-selected" | "graph-generator-selected-wasm";
  sourceError?: string;
} {
  let sourceMode: "auto" | "git" | "path" = "auto";
  let attr: "graph-generator-selected" | "graph-generator-selected-wasm" =
    "graph-generator-selected";
  let sourceError: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const tok = String(argv[i] || "").trim();
    if (tok === "--attr" && i + 1 < argv.length) {
      const value = String(argv[++i] || "").trim();
      if (value === "graph-generator-selected" || value === "graph-generator-selected-wasm") {
        attr = value;
      } else sourceError = `invalid --attr value '${value}'`;
      continue;
    }
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
  return { sourceMode, attr, sourceError };
}
async function chooseFlakeRef(opts: {
  workspaceRoot: string;
  target: string;
  sourceMode: "auto" | "git" | "path";
  graphPath: string;
  attr: "graph-generator-selected" | "graph-generator-selected-wasm";
  env: NodeJS.ProcessEnv;
  devOverrides: DevOverrideValues;
  wasmBackend?: string;
  onlyCpp?: boolean;
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
        command: ensureNixStoreToolPathSync("git", opts.env),
        args: ["ls-files", "-z", "--others", "--exclude-standard"],
        cwd: opts.workspaceRoot,
        env: opts.env,
        allowFailure: true,
      }),
  });
  const localDevelopment =
    opts.sourceMode === "path" ||
    (opts.sourceMode === "auto" && isLikelyTempWorkspace) ||
    inventory.localDevelopment ||
    evaluationBundleHasLanguageOverrides(opts.devOverrides);
  if (inventory.localDevelopment) {
    console.error(
      `[build-selected] classification=local-development reason=relevant-untracked source-mode=${opts.sourceMode}:`,
    );
    for (const file of inventory.relevant.slice(0, 50)) console.error(` - ${file}`);
  }
  const filtered = await makeFilteredFlakeRef({
    workspaceRoot: opts.workspaceRoot,
    attr: opts.attr,
    logPrefix: "[build-selected]",
    graphPath: opts.graphPath,
    target: opts.target,
    classification: localDevelopment ? "local-development" : "hermetic",
    env: opts.env,
    selectorEnv: process.env,
    devOverrides: opts.devOverrides,
    wasmBackend: opts.wasmBackend,
    onlyCpp: opts.onlyCpp,
  });
  return {
    flakeRef: filtered.flakeRef,
    workspaceRoot: filtered.workspaceRoot,
    cleanup: filtered.cleanup,
    localDevelopment,
  };
}
async function main(artifactToolsRoot: string) {
  const devOverrides = evaluationBundleDevOverrides(getArgvTokens(), {});
  const parsedSource = parseSourceMode(getArgvTokens());
  if (parsedSource.sourceError) {
    console.error(`[build-selected] ${parsedSource.sourceError}`);
    process.exit(2);
  }
  const targetRaw = getFlagStr("target", "").trim();
  if (!targetRaw) {
    console.error("--target is required (e.g., --target //projects/apps/foo:foo)");
    console.error("optional: --source=auto|git|path");
    process.exit(2);
  }
  const cwd = path.resolve(getFlagStr("workspace-root", "").trim() || process.cwd());
  const buckActionInputs = getFlagStr("buck-action-inputs", "").trim();
  const buckActionRoot = buckActionInputs !== "";
  assertNoArtifactSelectorInjection(process.env, {
    allow: buckActionRoot
      ? ["VBR_ARTIFACT_TOOLS_ROOT", "VIBEROOTS_ROOT"]
      : ["VBR_ARTIFACT_TOOLS_ROOT"],
  });
  const workspaceRoot = await findRepoRoot(cwd);
  if (!(await workspaceFlakeDir(workspaceRoot))) {
    console.error(
      `workspace flake not found at ${workspaceRoot}/.viberoots/workspace/flake.nix or ${workspaceRoot}/flake.nix`,
    );
    process.exit(2);
  }
  const target = await resolveSelectedTargetLabel(workspaceRoot, targetRaw, { baseDir: cwd });
  const declaredGraphPath = getFlagStr("buck-graph-json", "").trim();
  const graphPath = declaredGraphPath
    ? path.resolve(declaredGraphPath)
    : path.join(workspaceRoot, DEFAULT_GRAPH_PATH);
  const defaultRoots = artifactGraphQueryRoots().join(",");
  const queryRoots = defaultRoots;
  const exporterDebug = (process.env.EXPORTER_DEBUG || "").trim();
  const validation = (process.env.EXPORTER_VALIDATION || "").trim() || "warn";
  const declaredArtifactToolsRoot = artifactToolsRoot;
  const declaredViberootsSource = buckActionRoot
    ? String(process.env.VIBEROOTS_ROOT || "").trim()
    : "";
  const orchestrationEnv = buildArtifactEnvironment({
    baseEnv: withoutArtifactEnvironmentInfluence(withoutEvaluationSelectors(process.env)),
    mode: String(process.env.CI || "").trim() ? "ci" : "local",
    stateRoot: path.join(workspaceRoot, "buck-out", "tmp", "artifact-environment"),
    workspaceRoot,
    artifactToolsRoot: declaredArtifactToolsRoot,
    internal: {
      BUCK_TEST_SRC: workspaceRoot,
      WORKSPACE_ROOT: workspaceRoot,
      EXPORTER_DEBUG: exporterDebug,
      EXPORTER_VALIDATION: validation,
      BUCK_QUERY_ROOTS: queryRoots,
      BUCK_TARGET: target,
      BUCK_GRAPH_JSON: graphPath,
    },
  });
  const activeArtifactToolsRoot = String(orchestrationEnv.VBR_ARTIFACT_TOOLS_ROOT || "");
  const canonicalViberootsSource = path.join(activeArtifactToolsRoot, "share", "viberoots-source");
  const canonicalViberootsReal = await fsp.realpath(canonicalViberootsSource);
  if (!canonicalViberootsReal.startsWith("/nix/store/")) {
    throw new Error(
      `artifact build requires immutable viberoots source authority: ${canonicalViberootsReal}`,
    );
  }
  if (buckActionRoot && declaredViberootsSource) {
    // Canonical re-exec strips VIBEROOTS_ROOT from the ambient env; the tool authority
    // check above already asserted the closure is authentic, so this comparison is only
    // meaningful when the Buck action bootstrap still carries a declared value.
    const declaredViberootsReal = await fsp.realpath(declaredViberootsSource);
    if (declaredViberootsReal !== canonicalViberootsReal) {
      throw new Error(
        `Buck action viberoots source authority mismatch: declared=${declaredViberootsSource} canonical=${canonicalViberootsSource}`,
      );
    }
  }
  orchestrationEnv.VIBEROOTS_ROOT = canonicalViberootsSource;
  await withScopedEnv(orchestrationEnv, async () => {
    try {
      const existing = await fsp.readFile(graphPath, "utf8");
      const trimmed = String(existing || "").trim();
      if (trimmed && trimmed !== "[]")
        console.error(`[build-selected] using existing graph: ${graphPath}`);
      else console.error(`[build-selected] exporting graph to ${graphPath}`);
    } catch {
      console.error(`[build-selected] exporting graph to ${graphPath}`);
    }
    await materializeSelectedGraph({ workspaceRoot, target, graphPath });
  });
  await runNodeWithZx({
    cwd: workspaceRoot,
    zxInitPath: zxInitPath(workspaceRoot),
    script: buildToolPath(workspaceRoot, "tools/buck/enforce-node-patch-requirements.ts"),
    args: ["--check"],
    env: orchestrationEnv,
    nodeBin: ensureNixStoreToolPathSync("node", orchestrationEnv),
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
  const cppTargetAttrSuffix = sanitizeAttrNameFromLabel(target);
  console.error(`[build-selected] cppTargetAttrSuffix=${cppTargetAttrSuffix}`);
  const inheritedEnv = withoutArtifactEnvironmentInfluence(
    withoutEvaluationSelectors(
      withSanitizedInheritedNixConfig({
        ...process.env,
        EXPORTER_VALIDATION: validation,
        EXPORTER_DEBUG: exporterDebug,
      }),
    ),
  );
  const sanitizedEnv = buildArtifactEnvironment({
    baseEnv: inheritedEnv,
    mode: String(process.env.CI || "").trim() ? "ci" : "local",
    stateRoot: path.join(workspaceRoot, "buck-out", "tmp", "artifact-environment"),
    workspaceRoot,
    artifactToolsRoot: declaredArtifactToolsRoot,
    internal: {
      BUCK_TARGET: target,
      BUCK_GRAPH_JSON: graphPath,
      WORKSPACE_ROOT: workspaceRoot,
    },
  });
  const flakeSource = await chooseFlakeRef({
    workspaceRoot,
    target,
    sourceMode: parsedSource.sourceMode,
    graphPath,
    attr: parsedSource.attr,
    env: sanitizedEnv,
    devOverrides,
    wasmBackend: getFlagStr("wasm-backend", "").trim(),
    onlyCpp: getFlagBool("planner-only-cpp"),
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
      const command = ensureNixStoreToolPathSync(args[0] || "nix", flakeEnv);
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

const declaredBuckAction = getFlagStr("buck-action-inputs", "").trim() !== "";
const artifactToolsRoot = enterCanonicalArtifactEntrypoint(process.cwd(), {
  declaredBuckAction,
  allowDevOverrides: true,
});
runMain(async () => await main(artifactToolsRoot));
