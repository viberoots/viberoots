#!/usr/bin/env zx-wrapper
import type { ResourceGraphEdge, ResourceGraphNode } from "./resource-graph-export";

export type RuntimeLinkStatus = "runtime-linked" | "pre-read-model" | "runtime-unlinked";

export type RuntimeLinkMarkers = {
  importedIntentGraph: { status: "indexed" | "missing"; nodeCount: number };
  linkedRuntimeRows: number;
  preReadModelRuntimeRows: number;
  unlinkedRuntimeRows: number;
  examples: Array<{ kind: string; name: string; status: RuntimeLinkStatus; reason: string }>;
};

const LINKABLE_RUNTIME_KINDS = new Set([
  "ExecutionSnapshot",
  "DeployRun",
  "ProviderEvidence",
  "RunAction",
  "CurrentStageState",
  "StageHistoryEntry",
  "StaticWebappUploadSession",
  "CleanupEvidence",
]);

const REF_LINKED_RUNTIME_KINDS = new Set([
  "RuntimeInput",
  "AuthProviderProfile",
  "ControlPlaneReadinessEvidence",
  "ControlPlaneObservabilityEvidence",
  "MiniMigrationPreflightEvidence",
]);

export function classifyRuntimeLinkStatus(opts: {
  intentGraphImported: boolean;
  intentNodeCount: number;
  runtimeNodes: ResourceGraphNode[];
  runtimeEdges: ResourceGraphEdge[];
}): { status: RuntimeLinkStatus; markers: RuntimeLinkMarkers } {
  const linkedRuntimeUids = linkedRuntimeNodeUids(opts.runtimeEdges);
  const classifiableNodes = opts.runtimeNodes.filter((node) => isClassifiableRuntimeNode(node));
  const linked = classifiableNodes.filter((node) => linkedRuntimeUids.has(node.uid));
  const unresolved = classifiableNodes.filter((node) => !linkedRuntimeUids.has(node.uid));
  const preReadModel = opts.intentGraphImported ? [] : unresolved;
  const unlinked = opts.intentGraphImported ? unresolved : [];
  const status =
    preReadModel.length > 0
      ? "pre-read-model"
      : unlinked.length > 0
        ? "runtime-unlinked"
        : "runtime-linked";
  return {
    status,
    markers: {
      importedIntentGraph: {
        status: opts.intentGraphImported ? "indexed" : "missing",
        nodeCount: opts.intentNodeCount,
      },
      linkedRuntimeRows: linked.length,
      preReadModelRuntimeRows: preReadModel.length,
      unlinkedRuntimeRows: unlinked.length,
      examples: [
        ...examples(preReadModel, "pre-read-model"),
        ...examples(unlinked, "runtime-unlinked"),
      ],
    },
  };
}

function linkedRuntimeNodeUids(edges: ResourceGraphEdge[]) {
  const linked = new Set(
    edges.filter((edge) => edge.toKind === "Deployment").map((edge) => edge.fromUid),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (
        edge.toUid.startsWith("runtime:") &&
        linked.has(edge.toUid) &&
        !linked.has(edge.fromUid)
      ) {
        linked.add(edge.fromUid);
        changed = true;
      }
    }
  }
  return linked;
}

function isClassifiableRuntimeNode(node: ResourceGraphNode) {
  if (LINKABLE_RUNTIME_KINDS.has(node.kind)) {
    return typeof (node.facts as any)?.deploymentId === "string";
  }
  if (REF_LINKED_RUNTIME_KINDS.has(node.kind)) return resourceGraphRefs(node).length > 0;
  if (node.kind === "WorkerEvidence") return Array.isArray((node.facts as any)?.leaseClaims);
  return false;
}

function resourceGraphRefs(node: ResourceGraphNode) {
  const refs = (node.facts as any)?.resourceGraphRefs;
  return Array.isArray(refs) ? refs : [];
}

function examples(nodes: ResourceGraphNode[], status: RuntimeLinkStatus) {
  const reason =
    status === "pre-read-model"
      ? "runtime row predates an imported resource graph read model"
      : "runtime row has no matching imported Deployment intent node";
  return nodes.slice(0, 5).map((node) => ({ kind: node.kind, name: node.name, status, reason }));
}
