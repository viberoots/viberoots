#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { GraphNode } from "../lib/graph";
import { readCompositeGraph } from "../lib/graph-view";
import { extractDeployments } from "./contract";
import { deploymentGraphReadOptions } from "./deployment-graph-read-options";
import { SUPPORTED_DEPLOYMENT_QUERY_ROOTS } from "./deployment-query";
import { readProjectConfigSync, redactedProjectConfigOverrides } from "./project-config";
import { collectDeploymentIntentResources } from "./resource-graph-collectors";
import { reviewedProviderCapability } from "./resource-graph-provider-capabilities";
import { collectRuntimeInventoryResources } from "./resource-graph-runtime";
import { DEPLOYMENT_RESOURCE_TAXONOMY } from "./resource-graph-taxonomy";
import type {
  DeploymentResourceInventory,
  DeploymentResourceInventoryEntry,
  DeploymentResourceInventoryOptions,
  DeploymentRuntimeInventorySources,
} from "./resource-graph-types";

export { DEPLOYMENT_RESOURCE_KINDS, DEPLOYMENT_RESOURCE_TAXONOMY } from "./resource-graph-taxonomy";
export type {
  DeploymentResourceInventory,
  DeploymentResourceInventoryEntry,
  DeploymentRuntimeInventorySources,
} from "./resource-graph-types";

export async function readDeploymentResourceInventory(
  opts: DeploymentResourceInventoryOptions = {},
): Promise<DeploymentResourceInventory> {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const graph = await readCompositeGraph(deploymentGraphReadOptions(workspaceRoot, opts.graphPath));
  return createDeploymentResourceInventory(graph.nodes, {
    workspaceRoot,
    runtimeSources: opts.runtimeSources,
    sidecars: {
      providerIndexAvailable: Object.keys(graph.providerIndex).length > 0,
      nodeLockIndexAvailable: Object.keys(graph.nodeLockIndex).length > 0,
    },
  });
}

export function createDeploymentResourceInventory(
  nodes: GraphNode[],
  opts: DeploymentResourceInventoryOptions & {
    sidecars?: DeploymentResourceInventory["graphRead"];
  } = {},
): DeploymentResourceInventory {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const loadedConfig = readProjectConfigSync(workspaceRoot);
  const extracted = extractDeployments(nodes, { workspaceRoot });
  const runtime = collectRuntimeInventoryResources(opts.runtimeSources);
  const resources = [
    ...extracted.deployments.flatMap(collectDeploymentIntentResources),
    ...collectResolvedInputResources(extracted.deployments),
    ...collectWorkspaceStateResources(loadedConfig, opts.sidecars),
    ...runtime.resources,
  ];
  return {
    taxonomyVersion: "deployment-resource-taxonomy@1",
    resources: uniqueResources(resources),
    errors: [...extracted.errors, ...runtime.errors, ...unsupportedProviderErrors(nodes)],
    graphRead: opts.sidecars || {
      providerIndexAvailable: false,
      nodeLockIndexAvailable: false,
    },
    workspace: {
      supportedDeploymentQueryRoots: SUPPORTED_DEPLOYMENT_QUERY_ROOTS,
      projectConfig: {
        sharedPath: path.relative(workspaceRoot, loadedConfig.sharedPath),
        localPath: path.relative(workspaceRoot, loadedConfig.localPath),
        localPresent: loadedConfig.localPresent,
        disallowLocalOverrides: process.env.VBR_DISALLOW_LOCAL_OVERRIDES === "1",
        redactedOverrides: redactedProjectConfigOverrides(loadedConfig.overrides),
      },
    },
  };
}

function unsupportedProviderErrors(nodes: GraphNode[]): string[] {
  return nodes
    .filter(
      (node) => typeof node.provider === "string" && !reviewedProviderCapability(node.provider),
    )
    .map((node) => `${String(node.name || "<unknown>")}: unsupported deployment provider`);
}

function collectResolvedInputResources(
  deployments: ReturnType<typeof extractDeployments>["deployments"],
): DeploymentResourceInventoryEntry[] {
  const out: DeploymentResourceInventoryEntry[] = [];
  for (const deployment of deployments) {
    const context = deployment.deploymentContext;
    if (context) {
      out.push(resolved("DeploymentContext", context.name, deployment.label));
    }
    const controlPlane = deployment.controlPlane;
    if (controlPlane) {
      const name = controlPlane.name;
      out.push(resolved("ControlPlaneProfile", name, deployment.label));
      out.push(
        resolved("ControlPlaneSelection", `${deployment.deploymentId}:${name}`, deployment.label),
      );
      out.push(
        resolved("ServiceClientProfile", `${name}:service-client`, deployment.label, [], {
          controlPlaneUrl: controlPlane.serviceClient.controlPlaneUrl,
          controlPlaneTokenRef: controlPlane.serviceClient.controlPlaneTokenRef,
        }),
      );
    }
  }
  return out;
}

function collectWorkspaceStateResources(
  loadedConfig: ReturnType<typeof readProjectConfigSync>,
  graphRead: DeploymentResourceInventory["graphRead"] | undefined,
): DeploymentResourceInventoryEntry[] {
  const redactedOverrides = redactedProjectConfigOverrides(loadedConfig.overrides);
  const resources: DeploymentResourceInventoryEntry[] = [
    {
      kind: "WorkspaceGraphState",
      id: "composite-graph-read",
      authority: "resolved_input",
      source: { class: "workspace_state", label: "composite-graph-read" },
      facts: {
        providerIndexAvailable: graphRead?.providerIndexAvailable || false,
        nodeLockIndexAvailable: graphRead?.nodeLockIndexAvailable || false,
      },
    },
  ];
  if (redactedOverrides.length > 0) {
    resources.push({
      kind: "LocalProjectConfigOverride",
      id: "local-project-config",
      authority: "resolved_input",
      source: {
        class: "workspace_state",
        label: "local-project-config-override",
        path: loadedConfig.localPath,
      },
      facts: { redactedOverrides },
    });
  }
  return resources;
}

function resolved(
  kind: DeploymentResourceInventoryEntry["kind"],
  id: string,
  label: string,
  refs: string[] = [],
  facts: Record<string, unknown> = {},
): DeploymentResourceInventoryEntry {
  return {
    kind,
    id,
    authority: "resolved_input",
    source: { class: "deployment_context", label },
    refs,
    facts,
  };
}

function uniqueResources(
  resources: DeploymentResourceInventoryEntry[],
): DeploymentResourceInventoryEntry[] {
  const seen = new Set<string>();
  return resources
    .filter((resource) => {
      const key = `${resource.kind}\0${resource.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
}
