#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { exportDeploymentResourceGraph } from "../../deployments/resource-graph-export";
import { syncBackendResourceGraphIndex } from "../../deployments/nixos-shared-host-control-plane-backend";
import {
  DEFAULT_RESOURCE_GRAPH_EDGES_PATH,
  DEFAULT_RESOURCE_GRAPH_NODES_PATH,
} from "../../lib/workspace-state-paths";

export async function importExportedGraph(ctx: {
  tmp: string;
  backend: Parameters<typeof syncBackendResourceGraphIndex>[0];
}) {
  await exportDeploymentResourceGraph({ workspaceRoot: ctx.tmp });
  await syncBackendResourceGraphIndex(ctx.backend, {
    nodes: await readJson(path.join(ctx.tmp, DEFAULT_RESOURCE_GRAPH_NODES_PATH)),
    edges: await readJson(path.join(ctx.tmp, DEFAULT_RESOURCE_GRAPH_EDGES_PATH)),
    sourceRef: "cloudflare-pages-real-reconciler-e2e",
    requireRuntimeEvidence: false,
  });
}

async function readJson(file: string) {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}
