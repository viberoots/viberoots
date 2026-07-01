#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type {
  DeploymentResourceEnvelope,
  DeploymentResourceEnvelopeSet,
} from "./resource-graph-envelope";
import { ensureDeploymentGraph } from "./deployment-query-helpers";
import {
  DEFAULT_RESOURCE_GRAPH_EDGES_PATH,
  DEFAULT_RESOURCE_GRAPH_ENVELOPES_PATH,
  DEFAULT_RESOURCE_GRAPH_NODES_PATH,
} from "../lib/workspace-state-paths";
import { sourceEdge, sourceKey, sourceNodesFor } from "./resource-graph-export-sources";

export type ResourceGraphNodeDocument = {
  apiVersion: "viberoots.resource-graph.nodes@1";
  nodes: ResourceGraphNode[];
};

export type ResourceGraphEdgeDocument = {
  apiVersion: "viberoots.resource-graph.edges@1";
  edges: ResourceGraphEdge[];
};

export type ResourceGraphNode = {
  uid: string;
  kind: string;
  name: string;
  source: DeploymentResourceEnvelope["source"];
  labels: Record<string, string>;
  statusRef: string;
  evidenceRef?: string;
};

export type ResourceGraphEdgeKind =
  | "artifact_input"
  | "component"
  | "control_plane"
  | "deployment_context"
  | "environment_stage"
  | "family"
  | "owner"
  | "policy"
  | "provider_target"
  | "provisioner"
  | "release_action"
  | "requirement"
  | "source"
  | "target_exception";

export type ResourceGraphEdge = {
  fromUid: string;
  toUid: string;
  kind: ResourceGraphEdgeKind;
  fromKind: string;
  toKind: string;
};

export type ResourceGraphExportResult = {
  envelopesPath: string;
  nodesPath: string;
  edgesPath: string;
  nodeCount: number;
  edgeCount: number;
};

export async function exportDeploymentResourceGraph(opts: { workspaceRoot: string }) {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  await ensureDeploymentGraph(workspaceRoot);
  const { readDeploymentResourceEnvelopes } = await import("./resource-graph-envelope");
  const envelopeSet = await readDeploymentResourceEnvelopes({ workspaceRoot });
  if (envelopeSet.errors.length > 0) {
    throw new Error(envelopeSet.errors.join("\n"));
  }
  const documents = createDeploymentResourceGraphDocuments(envelopeSet);
  const paths = outputPaths(workspaceRoot);
  await Promise.all([
    writeJson(paths.envelopesPath, documents.envelopes),
    writeJson(paths.nodesPath, documents.nodes),
    writeJson(paths.edgesPath, documents.edges),
  ]);
  return {
    ...paths,
    nodeCount: documents.nodes.nodes.length,
    edgeCount: documents.edges.edges.length,
  };
}

export function createDeploymentResourceGraphDocuments(
  envelopeSet: DeploymentResourceEnvelopeSet,
): {
  envelopes: DeploymentResourceEnvelopeSet;
  nodes: ResourceGraphNodeDocument;
  edges: ResourceGraphEdgeDocument;
} {
  const envelopes = sortEnvelopes(envelopeSet.envelopes);
  const sourceNodes = sourceNodesFor(envelopes);
  return {
    envelopes: { ...envelopeSet, envelopes },
    nodes: {
      apiVersion: "viberoots.resource-graph.nodes@1",
      nodes: [...resourceNodesFor(envelopes), ...sourceNodes].sort(nodeSort),
    },
    edges: {
      apiVersion: "viberoots.resource-graph.edges@1",
      edges: edgesFor(envelopes, sourceNodes),
    },
  };
}

function resourceNodesFor(envelopes: DeploymentResourceEnvelope[]): ResourceGraphNode[] {
  return envelopes.map((envelope) => ({
    uid: envelope.metadata.uid,
    kind: envelope.kind,
    name: String(envelope.metadata.name || ""),
    source: envelope.source,
    labels: envelope.metadata.labels,
    statusRef: envelope.statusRef,
    ...(envelope.evidenceRef ? { evidenceRef: envelope.evidenceRef } : {}),
  }));
}

function edgesFor(
  envelopes: DeploymentResourceEnvelope[],
  sourceNodes: ResourceGraphNode[],
): ResourceGraphEdge[] {
  const byUid = new Map(envelopes.map((envelope) => [envelope.metadata.uid, envelope]));
  const sourceUidByKey = new Map(sourceNodes.map((node) => [sourceKey(node.source), node.uid]));
  const edges = envelopes.flatMap((envelope) => {
    const sourceUid = sourceUidByKey.get(sourceKey(envelope.source));
    return [
      ...envelope.metadata.ownerReferences.map((ref) =>
        edge(edgeKind(envelope.kind, ref.kind), envelope, ref.uid, byUid),
      ),
      ...envelope.policyRefs.map((uid) => edge("policy", envelope, uid, byUid)),
      ...(sourceUid ? [sourceEdge(envelope, sourceUid)] : []),
    ];
  });
  return uniqueEdges(edges).sort(edgeSort);
}

function edge(
  kind: ResourceGraphEdge["kind"],
  envelope: DeploymentResourceEnvelope,
  toUid: string,
  byUid: Map<string, DeploymentResourceEnvelope>,
): ResourceGraphEdge {
  return {
    fromUid: envelope.metadata.uid,
    toUid,
    kind,
    fromKind: envelope.kind,
    toKind: byUid.get(toUid)?.kind || "Unknown",
  };
}

function edgeKind(
  fromKind: string,
  toKind: DeploymentResourceEnvelope["kind"],
): ResourceGraphEdgeKind {
  if (toKind === "DeploymentFamily") return "family";
  if (toKind === "Component") return "component";
  if (toKind === "ProviderTarget") return "provider_target";
  if (toKind === "EnvironmentStage") return "environment_stage";
  if (toKind === "DeploymentContext") return "deployment_context";
  if (
    toKind === "ControlPlaneProfile" ||
    toKind === "ControlPlaneSelection" ||
    toKind === "ServiceClientProfile"
  )
    return "control_plane";
  if (toKind === "SecretRequirement" || toKind === "RuntimeConfigRequirement") return "requirement";
  if (toKind === "DeploymentTargetException") return "target_exception";
  if (toKind === "Provisioner") return "provisioner";
  if (toKind === "ArtifactInput") return "artifact_input";
  if (toKind === "ReleaseAction") return "release_action";
  if (toKind.endsWith("Policy")) return "policy";
  if (fromKind === "ArtifactInput" && toKind === "Deployment") return "artifact_input";
  return "owner";
}

function uniqueEdges(edges: ResourceGraphEdge[]): ResourceGraphEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.fromUid}\0${edge.toUid}\0${edge.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function edgeSort(left: ResourceGraphEdge, right: ResourceGraphEdge): number {
  return `${left.fromUid}:${left.kind}:${left.toUid}`.localeCompare(
    `${right.fromUid}:${right.kind}:${right.toUid}`,
  );
}

function nodeSort(left: ResourceGraphNode, right: ResourceGraphNode): number {
  return `${left.kind}:${left.name}:${left.uid}`.localeCompare(
    `${right.kind}:${right.name}:${right.uid}`,
  );
}

function sortEnvelopes(envelopes: DeploymentResourceEnvelope[]): DeploymentResourceEnvelope[] {
  return [...envelopes].sort((left, right) =>
    `${left.kind}:${left.metadata.name}:${left.metadata.uid}`.localeCompare(
      `${right.kind}:${right.metadata.name}:${right.metadata.uid}`,
    ),
  );
}

function outputPaths(workspaceRoot: string) {
  return {
    envelopesPath: path.join(workspaceRoot, DEFAULT_RESOURCE_GRAPH_ENVELOPES_PATH),
    nodesPath: path.join(workspaceRoot, DEFAULT_RESOURCE_GRAPH_NODES_PATH),
    edgesPath: path.join(workspaceRoot, DEFAULT_RESOURCE_GRAPH_EDGES_PATH),
  };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
