import * as fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { requireArtifactGraph } from "./artifact-graph-executor";
import { runNixBuildWithProgress } from "./run-runnable-nix";
import { resolveFinalPnpmStore } from "./update-pnpm-hash/realized-store";
import { pnpmStoreAttrFromImporter } from "./update-pnpm-hash/paths";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";
import type { ArtifactJobPurpose } from "../lib/artifact-build-policy";
import { withoutArtifactEnvironmentInfluence } from "../lib/artifact-environment";
import { targetPackageFromLabel } from "../lib/artifact-source-inventory";
import { chooseRunnableFlakeRef } from "./run-runnable-source";
import { withoutEvaluationSelectors } from "./evaluation-bundle-env";
import { runBoundedArtifactCommand } from "../lib/artifact-command-runner";
import { canonicalArtifactReentryEnvironment } from "./canonical-artifact-entrypoint";

function runnableArtifactBaseEnv(): Record<string, string> {
  return withoutArtifactEnvironmentInfluence(withoutEvaluationSelectors(process.env)) as Record<
    string,
    string
  >;
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

function isCanonicalArtifactNode(assertedRoot: string): boolean {
  const canonicalNode = path.join(assertedRoot, "bin", "node");
  return fs.realpathSync(process.execPath) === fs.realpathSync(canonicalNode);
}

async function buildSelectedInCanonicalSubprocess(opts: {
  workspaceRoot: string;
  target: string;
  sourceMode: "auto" | "git" | "path";
  artifactToolsRoot: string;
}): Promise<string> {
  const toolsRoot = opts.artifactToolsRoot;
  const wrapper = path.join(toolsRoot, "bin", "zx-wrapper");
  const script = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "run-runnable-artifact.ts",
  );
  const result = await runBoundedArtifactCommand({
    command: wrapper,
    args: [script, "--target", opts.target, `--source=${opts.sourceMode}`],
    cwd: opts.workspaceRoot,
    env: canonicalArtifactReentryEnvironment(opts.workspaceRoot, toolsRoot),
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.exitCode !== 0 || result.timedOut || result.interrupted) {
    throw new Error(`canonical selected artifact subprocess exited ${result.exitCode}`);
  }
  return lastOutPath(
    result.stdout,
    `graph-generator-selected produced no out path for ${opts.target}`,
  );
}

export async function buildRunnableManifest(
  workspaceRoot: string,
  opts: {
    sourceMode?: "auto" | "git" | "path";
    target?: string;
    purpose?: ArtifactJobPurpose;
    artifactToolsRoot: string;
  },
): Promise<string> {
  const sourceMode = opts.sourceMode || "auto";
  const graphPath = path.join(workspaceRoot, DEFAULT_GRAPH_PATH);
  await requireArtifactGraph({
    workspaceRoot,
    graphPath,
    target: opts.target,
    artifactToolsRoot: opts.artifactToolsRoot,
  });
  const source = await chooseRunnableFlakeRef({
    workspaceRoot,
    sourceMode,
    target: opts.target,
    attr: "graph-generator",
    purpose: opts.purpose || "local",
    artifactToolsRoot: opts.artifactToolsRoot,
  });
  const baseEnv = runnableArtifactBaseEnv();
  const sourceSelectors = {
    VBR_FILTERED_FLAKE_SNAPSHOT: "1",
    VBR_PNPM_FILTERED_SNAPSHOT_ROOT: source.workspaceRoot || workspaceRoot,
  };
  const stdout = await (async () => {
    try {
      return await runNixBuildWithProgress({
        workspaceRoot,
        env: baseEnv,
        internal: sourceSelectors,
        label: "build runnable manifest",
        artifactToolsRoot: opts.artifactToolsRoot,
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
  sourceMode: "auto" | "git" | "path",
  options: { label?: string; purpose?: ArtifactJobPurpose; artifactToolsRoot: string },
): Promise<string> {
  const artifactToolsRoot = options.artifactToolsRoot;
  if (!isCanonicalArtifactNode(artifactToolsRoot)) {
    return await buildSelectedInCanonicalSubprocess({
      workspaceRoot,
      target,
      sourceMode,
      artifactToolsRoot,
    });
  }
  const label = options.label || `build selected target ${target}`;
  const purpose = options.purpose || "local";
  const graphPath = path.join(workspaceRoot, DEFAULT_GRAPH_PATH);
  await requireArtifactGraph({ workspaceRoot, graphPath, target, artifactToolsRoot });
  const source = await chooseRunnableFlakeRef({
    workspaceRoot,
    sourceMode,
    target,
    attr: "graph-generator-selected",
    purpose,
    artifactToolsRoot,
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
            ...runnableArtifactBaseEnv(),
            VBR_FILTERED_FLAKE_SNAPSHOT: "1",
            VBR_PNPM_FILTERED_SNAPSHOT_ROOT: source.workspaceRoot || workspaceRoot,
          },
        })
      : null;
  const selectedEnv = runnableArtifactBaseEnv();
  const sourceSelectors = {
    VBR_FILTERED_FLAKE_SNAPSHOT: "1",
    VBR_PNPM_FILTERED_SNAPSHOT_ROOT: source.workspaceRoot || workspaceRoot,
  };
  let stdout = "";
  try {
    stdout = await runNixBuildWithProgress({
      workspaceRoot,
      env: selectedEnv,
      internal: sourceSelectors,
      label,
      artifactToolsRoot,
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
