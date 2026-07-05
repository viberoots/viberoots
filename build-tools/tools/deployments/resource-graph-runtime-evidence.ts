#!/usr/bin/env zx-wrapper
import { collectRuntimeInventoryResources } from "./resource-graph-runtime";
import { ADMITTED_RUNTIME_SOURCE_LABEL } from "./resource-graph-types";
import type { ResourceGraphEdge, ResourceGraphNode } from "./resource-graph-export";
import type {
  DeploymentResourceInventoryEntry,
  DeploymentRuntimeInventorySources,
} from "./resource-graph-types";

const REQUIRED_RUNTIME_EVIDENCE_KINDS = [
  "RuntimeInput",
  "AuthProviderProfile",
  "ControlPlaneReadinessEvidence",
  "ControlPlaneObservabilityEvidence",
  "MiniMigrationPreflightEvidence",
] as const;
const RUNTIME_EVIDENCE_KINDS = new Set<string>(REQUIRED_RUNTIME_EVIDENCE_KINDS);

type RuntimeEvidenceRow = {
  kind: string;
  name: string;
  source_class: string;
  source_label: string | null;
  document_json: unknown;
};

export type RuntimeEvidenceDocument = {
  kind: string;
  id: string;
  source: DeploymentResourceInventoryEntry["source"];
  refs?: string[];
  facts: Record<string, unknown>;
};

export function runtimeEvidenceDocuments(
  sources: DeploymentRuntimeInventorySources = {},
  opts: { required?: boolean } = {},
) {
  const collected = collectRuntimeInventoryResources(sources);
  const documents = collected.resources
    .filter((resource) => RUNTIME_EVIDENCE_KINDS.has(resource.kind))
    .map((resource) => ({
      kind: resource.kind,
      id: resource.id,
      source: resource.source,
      refs: resource.refs,
      facts: resource.facts || {},
    }));
  const errors = [
    ...collected.errors,
    ...(opts.required === false ? [] : missingRequiredKinds(documents)),
  ];
  if (errors.length > 0) {
    throw new Error(`resource graph runtime evidence invalid:\n${errors.join("\n")}`);
  }
  return documents;
}

function missingRequiredKinds(documents: RuntimeEvidenceDocument[]) {
  const present = new Set(documents.map((document) => document.kind));
  return REQUIRED_RUNTIME_EVIDENCE_KINDS.filter((kind) => !present.has(kind)).map(
    (kind) => `${kind}: required runtime evidence is missing`,
  );
}

export function runtimeEvidenceGraph(
  rows: RuntimeEvidenceRow[],
  deploymentUidById: Map<string, string>,
) {
  const nodes: ResourceGraphNode[] = [];
  const edges: ResourceGraphEdge[] = [];
  for (const row of rows) {
    const document = row.document_json as RuntimeEvidenceDocument;
    const name = String(document.id || row.name);
    nodes.push({
      uid: uid(row.kind, name),
      kind: row.kind,
      name,
      source: {
        class: row.source_class,
        label: row.source_label || ADMITTED_RUNTIME_SOURCE_LABEL,
      } as ResourceGraphNode["source"],
      labels: { "viberoots.dev/authority": "observed_runtime" },
      statusRef: `status:${uid(row.kind, name)}`,
      evidenceRef: `evidence:${uid(row.kind, name)}`,
      facts: document.facts,
    } as ResourceGraphNode);
    for (const ref of document.refs || []) {
      const deploymentUid = deploymentUidById.get(ref);
      if (deploymentUid) edges.push(edge(row.kind, name, deploymentUid));
    }
  }
  return { nodes, edges };
}

function edge(fromKind: string, name: string, deploymentUid: string) {
  return {
    fromUid: uid(fromKind, name),
    toUid: deploymentUid,
    kind: "evidence",
    fromKind,
    toKind: "Deployment",
  } as ResourceGraphEdge;
}

const uid = (kind: string, name: string) => `runtime:${kind}:${name}`;
