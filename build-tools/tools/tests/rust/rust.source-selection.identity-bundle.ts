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

export async function buildCurrentArtifactTools(
  workspace: string,
  immutableViberootsInputRoot: string,
): Promise<string> {
  const artifactToolsRoot = canonicalArtifactToolsRoot(process.cwd());
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
): Promise<{ outPath: string; bundleSource: string }> {
  const artifactToolsRoot = declaredArtifactToolsRoot || canonicalArtifactToolsRoot(workspace);
  const graphPath = path.join(workspace, ".viberoots", "workspace", "buck", "graph.json");
  const bundle = await makeFilteredFlakeRef({
    workspaceRoot: workspace,
    attr,
    target: attr === "graph-generator-selected" ? selectedTarget : undefined,
    graphPath,
    logPrefix: "[rust-identity-parity]",
    classification: "local-development",
    env: buildCanonicalArtifactEnvironment(workspace, { artifactToolsRoot }),
    selectorEnv: {},
    ...(immutableViberootsInputRoot ? { immutableViberootsInputRoot } : {}),
    preferRootFlake,
  });
  try {
    const { stdout } = await runArtifactNix({
      workspaceRoot: workspace,
      artifactToolsRoot,
      baseEnv: withoutArtifactEnvironmentInfluence(baseEnv),
      args: [
        ...nixFlakeFeatures,
        "build",
        "--accept-flake-config",
        "--no-write-lock-file",
        bundle.flakeRef,
        "--no-link",
        "--print-out-paths",
      ],
    });
    const outPath = String(stdout || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .at(-1);
    if (!outPath) throw new Error(`missing ${attr} output path`);
    return { outPath, bundleSource: bundle.workspaceRoot };
  } finally {
    await bundle.cleanup();
  }
}
