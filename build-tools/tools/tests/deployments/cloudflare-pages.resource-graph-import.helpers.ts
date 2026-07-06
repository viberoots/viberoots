#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { exportDeploymentResourceGraph } from "../../deployments/resource-graph-export";
import { syncBackendResourceGraphIndex } from "../../deployments/nixos-shared-host-control-plane-backend";
import {
  DEFAULT_RESOURCE_GRAPH_EDGES_PATH,
  DEFAULT_RESOURCE_GRAPH_NODES_PATH,
} from "../../lib/workspace-state-paths";
import type { CloudflarePagesRuntimeEvidenceHandoff } from "../../deployments/cloudflare-pages-resource-graph-runtime-evidence";

const REQUIRED_HANDOFF_SOURCES = [
  "runtimeInputs",
  "authProviderProfiles",
  "readinessEvidence",
  "observabilityEvidence",
  "miniMigrationEvidence",
] as const;

export async function importExportedGraph(ctx: {
  tmp: string;
  backend: Parameters<typeof syncBackendResourceGraphIndex>[0];
  deployment: { deploymentId: string };
  runtimeEvidenceHandoff: CloudflarePagesRuntimeEvidenceHandoff;
}) {
  await exportDeploymentResourceGraph({ workspaceRoot: ctx.tmp });
  await syncBackendResourceGraphIndex(ctx.backend, {
    nodes: await readJson(path.join(ctx.tmp, DEFAULT_RESOURCE_GRAPH_NODES_PATH)),
    edges: await readJson(path.join(ctx.tmp, DEFAULT_RESOURCE_GRAPH_EDGES_PATH)),
    sourceRef: "cloudflare-pages-real-reconciler-e2e",
    runtimeSources: runtimeSourcesFromHandoff(
      ctx.runtimeEvidenceHandoff,
      ctx.deployment.deploymentId,
    ),
  });
}

async function readJson(file: string) {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

export function runtimeSourcesFromHandoff(
  handoff: CloudflarePagesRuntimeEvidenceHandoff,
  deploymentId: string,
) {
  if (handoff.deploymentId !== deploymentId) {
    throw new Error(
      `resource graph runtime evidence handoff deployment mismatch: expected ${deploymentId}, got ${handoff.deploymentId}`,
    );
  }
  if (handoff.sourceRef !== "cloudflare-pages-control-plane-runtime-evidence") {
    throw new Error("resource graph runtime evidence handoff source is unsupported");
  }
  if (
    handoff.producedBy.path !== "cloudflare-pages-control-plane-reconciler" ||
    handoff.producedBy.deployRunIds.length === 0
  ) {
    throw new Error("resource graph runtime evidence handoff producer is incomplete");
  }
  for (const name of REQUIRED_HANDOFF_SOURCES) {
    const values = handoff.runtimeSources[name];
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`resource graph runtime evidence handoff missing ${name}`);
    }
  }
  return handoff.runtimeSources;
}
