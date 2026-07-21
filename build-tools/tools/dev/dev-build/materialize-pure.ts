import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const";
import { mkdirWithMacosMetadataExclusion } from "../../lib/macos-metadata";
import { inferRunnableFromOutPath } from "../../lib/runnables";
import { targetPackageFromLabel } from "../../lib/artifact-source-inventory";
import {
  evaluationBundleHasLanguageOverrides,
  type DevOverrideValues,
} from "../evaluation-bundle-selectors";
import { withoutEvaluationSelectors } from "../evaluation-bundle-env";
import { inspectWorkspaceArtifactSource } from "../artifact-policy-inspection";
import { makeFilteredFlakeRef } from "../filtered-flake";
import { runNixBuildWithProgress } from "../run-runnable-nix";
import {
  buildArtifactEnvironment,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import {
  extractSpecificTargets,
  listBinArtifacts,
  printManifestRunnables,
} from "./materialize-pure-runnables";

type NixBuildRunner = typeof runNixBuildWithProgress;

function materializeTimeoutSec(defaultSec: number): number {
  const raw = String(process.env.VBR_MATERIALIZE_TIMEOUT_SEC || "").trim();
  const parsed = Number(raw || String(defaultSec));
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultSec;
  return Math.floor(parsed);
}

async function evaluationBundle(
  root: string,
  attr: string,
  devOverrides: DevOverrideValues,
  wasmBackend: string,
  artifactToolsRoot: string,
  target = "",
) {
  const graphPath = path.join(root, DEFAULT_GRAPH_PATH);
  const artifactEnv = buildArtifactEnvironment({
    baseEnv: withoutArtifactEnvironmentInfluence(process.env),
    mode: String(process.env.CI || "").trim() ? "ci" : "local",
    stateRoot: path.join(root, "buck-out", "tmp", "artifact-environment"),
    workspaceRoot: root,
    artifactToolsRoot,
    internal: {
      BUCK_GRAPH_JSON: graphPath,
      ...(target ? { BUCK_TARGET: target, WORKSPACE_ROOT: root } : {}),
    },
  });
  const inventory = await inspectWorkspaceArtifactSource({
    workspaceRoot: root,
    targetPackages: target ? [targetPackageFromLabel(target)].filter(Boolean) : [],
    env: artifactEnv,
  });
  return await makeFilteredFlakeRef({
    workspaceRoot: root,
    attr,
    target,
    graphPath,
    logPrefix: "[dev-build]",
    classification:
      inventory.localDevelopment || evaluationBundleHasLanguageOverrides(devOverrides)
        ? "local-development"
        : "hermetic",
    env: artifactEnv,
    selectorEnv: withoutEvaluationSelectors(process.env),
    devOverrides,
    wasmBackend,
  });
}

async function nixBuildPrintOutPaths(opts: {
  root: string;
  env: Record<string, string>;
  internal?: Record<string, string>;
  args: string[];
  label: string;
  timeoutSec?: number;
  runNixBuild: NixBuildRunner;
  artifactToolsRoot: string;
}): Promise<string> {
  const tout = materializeTimeoutSec(opts.timeoutSec ?? 120);
  const previous = process.env.VBR_RUNNABLE_BUILD_TIMEOUT_SEC;
  process.env.VBR_RUNNABLE_BUILD_TIMEOUT_SEC = String(tout);
  try {
    return await opts.runNixBuild({
      workspaceRoot: opts.root,
      env: opts.env,
      internal: opts.internal,
      args: opts.args,
      label: opts.label,
      artifactToolsRoot: opts.artifactToolsRoot,
    });
  } finally {
    if (previous === undefined) delete process.env.VBR_RUNNABLE_BUILD_TIMEOUT_SEC;
    else process.env.VBR_RUNNABLE_BUILD_TIMEOUT_SEC = previous;
  }
}

export async function materializePureGraphIfEnabled(opts: {
  isCI: boolean;
  root: string;
  materialize: boolean;
  impure: boolean;
  restArgs: string[];
  devOverrides: DevOverrideValues;
  wasmBackend?: string;
  artifactToolsRoot: string;
  runNixBuild?: NixBuildRunner;
}): Promise<void> {
  if (opts.isCI || !opts.materialize || opts.impure) return;

  const linkDir = path.resolve(opts.root, ".viberoots", "workspace", "buck", "tmp");
  await mkdirWithMacosMetadataExclusion(linkDir);
  const linkName = path.join(linkDir, `buck-go-${Date.now()}`);

  const specific = extractSpecificTargets(opts.restArgs || []);
  if (specific.length > 0) {
    console.log("Materializing selected targets (pure):");
    for (const sel of specific) {
      const bundle = await evaluationBundle(
        opts.root,
        "graph-generator-pure-selected",
        opts.devOverrides,
        opts.wasmBackend || "",
        opts.artifactToolsRoot,
        sel,
      );
      try {
        const envSel = withoutArtifactEnvironmentInfluence(process.env);
        const selOut = await nixBuildPrintOutPaths({
          root: opts.root,
          env: envSel as Record<string, string>,
          internal: { VBR_FILTERED_FLAKE_SNAPSHOT: "1" },
          args: [
            "--no-write-lock-file",
            bundle.flakeRef,
            "--accept-flake-config",
            "--no-link",
            "--print-out-paths",
          ],
          label: `materialize selected target ${sel}`,
          timeoutSec: 600,
          runNixBuild: opts.runNixBuild ?? runNixBuildWithProgress,
          artifactToolsRoot: opts.artifactToolsRoot,
        });
        const outPath =
          String(selOut || "")
            .trim()
            .split("\n")
            .filter(Boolean)
            .pop() || "";
        if (!outPath) {
          console.log(` - ${sel}: (no out path)`);
          continue;
        }
        const runnable = await inferRunnableFromOutPath({ label: sel, outPath });
        if (runnable) {
          console.log(` - ${sel}: ${runnable.kind}`);
        } else {
          const bins = await listBinArtifacts(outPath);
          if (bins.length) for (const b of bins) console.log(` - ${sel}: ${b}`);
          else console.log(` - ${sel}: (not runnable; inspect ${outPath})`);
        }
      } catch (e) {
        console.log(` - ${sel}: (failed to materialize)`);
        throw e;
      } finally {
        await bundle.cleanup();
      }
    }
    return;
  }

  const bundle = await evaluationBundle(
    opts.root,
    "graph-generator-pure",
    opts.devOverrides,
    opts.wasmBackend || "",
    opts.artifactToolsRoot,
  );
  const envFull = withoutArtifactEnvironmentInfluence(process.env);
  const pureOut = await nixBuildPrintOutPaths({
    root: opts.root,
    env: envFull as Record<string, string>,
    internal: { VBR_FILTERED_FLAKE_SNAPSHOT: "1" },
    args: [
      "--no-write-lock-file",
      bundle.flakeRef,
      "--accept-flake-config",
      "--no-link",
      "--print-out-paths",
    ],
    label: "materialize full pure graph",
    timeoutSec: 420,
    runNixBuild: opts.runNixBuild ?? runNixBuildWithProgress,
    artifactToolsRoot: opts.artifactToolsRoot,
  }).finally(bundle.cleanup);
  const purePath =
    String(pureOut || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop() || "";
  if (!purePath) {
    console.warn(
      "[dev-build] WARNING: pure graph evaluation returned no out path. If your manifest is empty, ensure buck graph export succeeded and glue exists (.viberoots/workspace/providers/auto_map.bzl, TARGETS.auto).",
    );
  } else {
    await $({ stdio: "inherit", cwd: opts.root })`ln -sfn ${purePath} ${linkName}`;
    await $({
      stdio: "pipe",
      cwd: opts.root,
    })`ln -sfn ${purePath} ${path.join(linkDir, "runnable-manifest-current")}`;
  }
  await printManifestRunnables(linkName);
}
