#!/usr/bin/env zx-wrapper
import { getFlagStr } from "../lib/cli";
import { readCompositeGraph } from "../lib/graph-view";
import { findRepoRoot } from "../lib/repo";
import { deploymentGraphReadOptions } from "./deployment-graph-read-options";
import { extractDeployments } from "./contract";

async function main() {
  const workspaceRoot = await findRepoRoot(process.cwd());
  const graphPath = getFlagStr("graph", "");
  const { nodes } = await readCompositeGraph(deploymentGraphReadOptions(workspaceRoot, graphPath));
  const { deployments, errors } = extractDeployments(nodes, { workspaceRoot });
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(`deployment validation OK (${deployments.length} deployment(s))`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
