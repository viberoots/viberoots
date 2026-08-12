import * as fs from "node:fs/promises";
import path from "node:path";
import { runArtifactNix } from "../../ci/artifact-command";
import { makeFilteredFlakeRef } from "../../dev/filtered-flake";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import { artifactNixExperimentalFeatureArgs } from "../../lib/artifact-nix-policy";

const nixFlakeFeatures = artifactNixExperimentalFeatureArgs();
const defaultTarget = "//projects/apps/rust-parity:app";
let artifactRootSequence = 0;

export async function buildCurrentArtifactTools(
  workspace: string,
  immutableViberootsInputRoot: string,
): Promise<string> {
  const artifactToolsRoot = canonicalArtifactToolsRoot(process.cwd());
  const buildStart = Date.now();
  const result = await runArtifactNix({
    workspaceRoot: workspace,
    artifactToolsRoot,
    baseEnv: withoutArtifactEnvironmentInfluence(process.env),
    args: [
      ...nixFlakeFeatures,
      "build",
      "--no-link",
      "--print-out-paths",
      `path:${immutableViberootsInputRoot}#remote-worker-tools`,
    ],
  });
  console.warn(`[rust-identity-parity] artifact tools build ready in ${Date.now() - buildStart}ms`);
  const output = result.stdout.trim().split(/\s+/).at(-1);
  if (!output) throw new Error("current immutable source did not build artifact tools");
  return output;
}

export async function buildCanonicalBundle(
  workspace: string,
  attr: "graph-generator-selected" | "graph-generator",
  immutableViberootsInputRoot: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  selectedTarget: string = defaultTarget,
  declaredArtifactToolsRoot = "",
  preferRootFlake = false,
  derivationOutput: "out" | "provenance" = "out",
): Promise<{ outPath: string; bundleSource: string }> {
  const outputs = await buildCanonicalBundleOutputs(
    workspace,
    attr,
    immutableViberootsInputRoot,
    baseEnv,
    selectedTarget,
    declaredArtifactToolsRoot,
    preferRootFlake,
    [derivationOutput],
  );
  return outputs[derivationOutput];
}

export async function buildCanonicalBundleOutputs(
  workspace: string,
  attr: "graph-generator-selected" | "graph-generator",
  immutableViberootsInputRoot: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  selectedTarget: string = defaultTarget,
  declaredArtifactToolsRoot = "",
  preferRootFlake = false,
  derivationOutputs: readonly ("out" | "provenance")[] = ["out"],
): Promise<Record<"out" | "provenance", { outPath: string; bundleSource: string }>> {
  const artifactToolsRoot = declaredArtifactToolsRoot || canonicalArtifactToolsRoot(workspace);
  const graphPath = path.join(workspace, ".viberoots", "workspace", "buck", "graph.json");
  const bundle = await makeFilteredFlakeRef({
    workspaceRoot: workspace,
    attr,
    target: attr === "graph-generator-selected" ? selectedTarget : undefined,
    graphPath,
    logPrefix: "[rust-identity-parity]",
    classification: "local-development",
    env: buildCanonicalArtifactEnvironment(workspace, {
      artifactToolsRoot,
    }),
    selectorEnv: {},
    ...(immutableViberootsInputRoot ? { immutableViberootsInputRoot } : {}),
    preferRootFlake,
  });
  try {
    const rootDir = path.join(workspace, ".viberoots-test-artifact-roots.noindex");
    await fs.mkdir(rootDir, { recursive: true });
    const rootPrefix = `${process.pid}-${artifactRootSequence++}`;
    const results = {} as Record<"out" | "provenance", { outPath: string; bundleSource: string }>;
    const buildStart = Date.now();
    const { stdout } = await runArtifactNix({
      workspaceRoot: workspace,
      artifactToolsRoot,
      baseEnv: withoutArtifactEnvironmentInfluence(baseEnv),
      args: [
        ...nixFlakeFeatures,
        "build",
        "--accept-flake-config",
        "--no-write-lock-file",
        "--no-link",
        "--json",
        ...derivationOutputs.map((output) => `${bundle.flakeRef}^${output}`),
      ],
    });
    console.warn(
      `[rust-identity-parity] bundle build target=${selectedTarget} outputs=${derivationOutputs.join(",")} ready in ${Date.now() - buildStart}ms`,
    );
    const buildEntries = JSON.parse(stdout) as Array<{ outputs?: Record<string, string> }>;
    for (const derivationOutput of derivationOutputs) {
      const outPath = buildEntries
        .map((entry) => entry.outputs?.[derivationOutput])
        .find((value): value is string => Boolean(value));
      if (!outPath) throw new Error(`missing ${attr} output path`);
      await fs.symlink(outPath, path.join(rootDir, `${rootPrefix}-${derivationOutput}`));
      results[derivationOutput] = { outPath, bundleSource: bundle.workspaceRoot };
    }
    return results;
  } finally {
    await bundle.cleanup();
  }
}
