#!/usr/bin/env zx-wrapper
import { getFlagStr } from "../lib/cli";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { readCompositeGraph } from "../lib/graph-view";
import { DEPLOYMENT_EXTRACTED_METADATA_SCHEMA } from "./deployment-control-plane-contract";
import { extractDeployments } from "./contract";

async function main() {
  const graphPath = getFlagStr("graph", DEFAULT_GRAPH_PATH);
  const { nodes } = await readCompositeGraph({ graphPath });
  const { deployments, errors } = extractDeployments(nodes);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(
    JSON.stringify({ schemaVersion: DEPLOYMENT_EXTRACTED_METADATA_SCHEMA, deployments }, null, 2),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
