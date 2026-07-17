import * as fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { ensureGraph } from "../buck/glue-run";
import { runNixBuildWithProgress } from "./run-runnable-nix";
import { resolveFinalPnpmStore } from "./update-pnpm-hash/realized-store";
import { pnpmStoreAttrFromImporter } from "./update-pnpm-hash/paths";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";
import type { ArtifactJobPurpose } from "../lib/artifact-build-policy";
import { targetPackageFromLabel } from "../lib/artifact-source-inventory";
import { chooseRunnableFlakeRef } from "./run-runnable-source";
import { withoutEvaluationSelectors } from "./evaluation-bundle-env";

async function withScopedGraphEnv<T>(
  workspaceRoot: string,
  entries: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  const merged = {
    WORKSPACE_ROOT: workspaceRoot,
    BUCK_TEST_SRC: workspaceRoot,
    ...entries,
  };
  for (const [k, v] of Object.entries(merged)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function lastOutPath(stdout: string, err: string): string {
  const outPath =
    String(stdout || "")
      .trim()
      .split(/\n+/)
      .filter(Boolean)
      .pop() || "";
  if (!outPath) throw new Error(err);
  return outPath;
}

export async function buildRunnableManifest(
  workspaceRoot: string,
  opts?: {
    sourceMode?: "auto" | "git" | "path";
    target?: string;
    purpose?: ArtifactJobPurpose;
  },
): Promise<string> {
  const sourceMode = opts?.sourceMode || "auto";
  const graphPath = path.join(workspaceRoot, DEFAULT_GRAPH_PATH);
  await withScopedGraphEnv(workspaceRoot, { BUCK_GRAPH_JSON: graphPath }, async () => {
    await ensureGraph();
  });
  const source = await chooseRunnableFlakeRef({
    workspaceRoot,
    sourceMode,
    target: opts?.target,
    attr: "graph-generator",
    purpose: opts?.purpose || "local",
  });
  const baseEnv: Record<string, string> = {
    ...withoutEvaluationSelectors(process.env),
    VBR_FILTERED_FLAKE_SNAPSHOT: "1",
    VBR_PNPM_FILTERED_SNAPSHOT_ROOT: source.workspaceRoot || workspaceRoot,
  };
  const stdout = await (async () => {
    try {
      return await runNixBuildWithProgress({
        workspaceRoot,
        env: baseEnv,
        label: "build runnable manifest",
        args: [
          "--no-write-lock-file",
          "--option",
          "eval-cache",
          "false",
          source.flakeRef,
          "--accept-flake-config",
          "--no-link",
          "--print-out-paths",
          "-L",
        ],
      });
    } finally {
      await source.cleanup?.();
    }
  })();
  const outPath = lastOutPath(stdout, "graph-generator did not emit an output path");
  const linkDir = path.join(workspaceRoot, "buck-out", "tmp");
  const linkPath = path.join(linkDir, "runnable-manifest-current");
  await mkdirWithMacosMetadataExclusion(path.join(workspaceRoot, "buck-out"));
  await mkdirWithMacosMetadataExclusion(linkDir);
  try {
    await fsp.rm(linkPath, { recursive: true, force: true });
  } catch {}
  await fsp.symlink(outPath, linkPath);
  return path.join(linkPath, "manifest.json");
}

export async function buildSelectedOutPath(
  workspaceRoot: string,
  target: string,
  sourceMode: "auto" | "git" | "path" = "auto",
  labelOrOptions:
    | string
    | { label?: string; purpose?: ArtifactJobPurpose } = `build selected target ${target}`,
): Promise<string> {
  const label =
    typeof labelOrOptions === "string"
      ? labelOrOptions
      : labelOrOptions.label || `build selected target ${target}`;
  const purpose = typeof labelOrOptions === "string" ? "local" : labelOrOptions.purpose || "local";
  const graphPath = path.join(workspaceRoot, DEFAULT_GRAPH_PATH);
  await withScopedGraphEnv(
    workspaceRoot,
    { BUCK_GRAPH_JSON: graphPath, BUCK_TARGET: target },
    async () => {
      await ensureGraph();
    },
  );
  const source = await chooseRunnableFlakeRef({
    workspaceRoot,
    sourceMode,
    target,
    attr: "graph-generator-selected",
    purpose,
  });
  const targetImporter = targetPackageFromLabel(target);
  const fixedStore =
    targetImporter &&
    (await fsp
      .access(path.join(workspaceRoot, targetImporter, "pnpm-lock.yaml"))
      .then(() => true)
      .catch(() => false))
      ? await resolveFinalPnpmStore({
          repoRoot: workspaceRoot,
          importer: targetImporter,
          flakeRef: source.flakeRef,
          attrPath: pnpmStoreAttrFromImporter(targetImporter),
          env: {
            ...withoutEvaluationSelectors(process.env),
            VBR_FILTERED_FLAKE_SNAPSHOT: "1",
            VBR_PNPM_FILTERED_SNAPSHOT_ROOT: source.workspaceRoot || workspaceRoot,
          },
        })
      : null;
  const selectedEnv: Record<string, string> = {
    ...withoutEvaluationSelectors(process.env),
    VBR_FILTERED_FLAKE_SNAPSHOT: "1",
    VBR_PNPM_FILTERED_SNAPSHOT_ROOT: source.workspaceRoot || workspaceRoot,
  };
  let stdout = "";
  try {
    stdout = await runNixBuildWithProgress({
      workspaceRoot,
      env: selectedEnv,
      label,
      args: [
        "--no-write-lock-file",
        "--option",
        "eval-cache",
        "false",
        source.flakeRef,
        "--accept-flake-config",
        "--no-link",
        "--print-out-paths",
        "-L",
      ],
    });
  } finally {
    await fixedStore?.cleanup();
    await source.cleanup?.();
  }
  return lastOutPath(stdout, `graph-generator-selected produced no out path for ${target}`);
}
