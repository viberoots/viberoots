#!/usr/bin/env zx-wrapper
import { getFlagStr } from "../lib/cli.ts";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const.ts";
import { readCompositeGraph } from "../lib/graph-view.ts";
import { extractMiniDeployments } from "./contract.ts";

async function main() {
  const graphPath = getFlagStr("graph", DEFAULT_GRAPH_PATH);
  const { nodes } = await readCompositeGraph({ graphPath });
  const { deployments, errors } = extractMiniDeployments(nodes);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(`deployment validation OK (${deployments.length} mini-dev-container deployment(s))`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
