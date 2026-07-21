import path from "node:path";
import { requireGeneratedGraph } from "../buck/generated-graph";
import { glueFingerprintFresh } from "./install/glue-freshness";
import { staleMetadataError } from "./install/metadata-mode";
import { artifactGraphQueryRoots } from "../buck/artifact-graph-query-roots";
import {
  buildArtifactEnvironment,
  withoutArtifactEnvironmentInfluence,
} from "../lib/artifact-environment";
import { withoutEvaluationSelectors } from "./evaluation-bundle-env";

export type ArtifactGraphExecutionOptions = {
  workspaceRoot: string;
  target?: string;
  graphPath?: string;
  queryRoots?: string[];
  baseEnv?: NodeJS.ProcessEnv;
  artifactToolsRoot: string;
};

export function canonicalArtifactGraphEnvironment(
  opts: ArtifactGraphExecutionOptions,
): NodeJS.ProcessEnv {
  const toolsRoot = opts.artifactToolsRoot;
  const baseEnv = opts.baseEnv || process.env;
  const toolSourceRoot = path.join(toolsRoot, "share", "viberoots-source");
  const queryRoots = opts.queryRoots || artifactGraphQueryRoots();
  return buildArtifactEnvironment({
    baseEnv: withoutArtifactEnvironmentInfluence(withoutEvaluationSelectors(baseEnv)),
    mode: String(baseEnv.CI || "").trim() ? "ci" : "local",
    stateRoot: path.join(opts.workspaceRoot, "buck-out", "tmp", "artifact-graph-environment"),
    workspaceRoot: opts.workspaceRoot,
    artifactToolsRoot: toolsRoot,
    internal: {
      WORKSPACE_ROOT: opts.workspaceRoot,
      BUCK_TEST_SRC: opts.workspaceRoot,
      REPO_ROOT: toolSourceRoot,
      VIBEROOTS_ROOT: toolSourceRoot,
      VIBEROOTS_SOURCE_ROOT: toolSourceRoot,
      BUCK_GRAPH_JSON: opts.graphPath,
      BUCK_TARGET: opts.target,
      BUCK_QUERY_ROOTS: queryRoots.join(","),
      BUCK_TARGET_PLATFORMS: "prelude//platforms:default",
    },
  });
}

function authority(opts: ArtifactGraphExecutionOptions) {
  const env = canonicalArtifactGraphEnvironment(opts);
  const toolsRoot = String(env.VBR_ARTIFACT_TOOLS_ROOT || "");
  return {
    env,
    nodeBin: path.join(toolsRoot, "bin", "node"),
    buck2Bin: path.join(toolsRoot, "bin", "buck2"),
    nixBin: path.join(toolsRoot, "bin", "nix"),
    toolSourceRoot: String(env.VIBEROOTS_SOURCE_ROOT || ""),
  };
}

export async function requireArtifactGraph(opts: ArtifactGraphExecutionOptions): Promise<void> {
  authority(opts);
  await requireGeneratedGraph({
    graphPath:
      opts.graphPath || path.join(opts.workspaceRoot, ".viberoots/workspace/buck/graph.json"),
    target: opts.target,
  });
}

export async function requireArtifactGlue(opts: ArtifactGraphExecutionOptions): Promise<void> {
  await requireArtifactGraph(opts);
  const freshness = await glueFingerprintFresh(opts.workspaceRoot);
  if (!freshness.fresh) {
    throw staleMetadataError(
      ".viberoots/workspace/prebuild-fingerprint.json",
      `generated provider/glue metadata requires reconciliation (${freshness.reason})`,
    );
  }
}
