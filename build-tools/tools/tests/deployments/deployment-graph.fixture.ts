#!/usr/bin/env zx-wrapper
import { reconcileSyntheticGeneratedGraph } from "../lib/generated-graph.fixture";

export async function reconcileSyntheticDeploymentGraph(
  workspaceRoot: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  return await reconcileSyntheticGeneratedGraph(workspaceRoot, baseEnv);
}
