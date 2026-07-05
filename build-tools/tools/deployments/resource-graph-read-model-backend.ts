#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import type { SourcePlanEvidence } from "../lib/source-plan-evidence";
import { redactControlPlaneReadModel } from "./deployment-control-plane-read-redaction";
import { controlPlaneTableClassification } from "./resource-graph-read-model-tables";
import { runtimeEvidenceDocuments } from "./resource-graph-runtime-evidence";
import { readRuntimeResourceGraph } from "./resource-graph-runtime-read-model";
import type { ResourceGraphEdgeDocument, ResourceGraphNodeDocument } from "./resource-graph-export";
import type { DeploymentRuntimeInventorySources } from "./resource-graph-types";
import {
  decodeBackendJson,
  queryBackend,
  withBackendClient,
  type BackendQueryable,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend-db";

export type ResourceGraphReadModelInput = {
  nodes: ResourceGraphNodeDocument;
  edges: ResourceGraphEdgeDocument;
  sourceRef: string;
  sourcePlans?: SourcePlanEvidence[];
  runtimeSources?: DeploymentRuntimeInventorySources;
  requireRuntimeEvidence?: boolean;
  importedAt?: string;
};

type ResourceGraphNodeRow = {
  document_json: unknown;
  source_selection_json: unknown | null;
};

type ResourceGraphEdgeRow = { document_json: unknown };
type ResourceGraphImportCountRow = { count: string | number };

export async function syncBackendResourceGraphIndex(
  backend: NixosSharedHostControlPlaneBackendTarget,
  input: ResourceGraphReadModelInput,
) {
  const importedAt = input.importedAt || new Date().toISOString();
  const importId = importIdFor(input.sourceRef, input.nodes, input.edges);
  const sourcePlans = sourcePlanIndex(input.sourcePlans || []);
  const runtimeEvidence = runtimeEvidenceDocuments(input.runtimeSources, {
    required: input.requireRuntimeEvidence !== false,
  });
  await withBackendClient(backend, async (client) => {
    await client.query("BEGIN");
    try {
      await writeImport(client, input, importId, importedAt);
      await client.query("DELETE FROM resource_graph_runtime_evidence");
      await client.query("DELETE FROM resource_graph_edges");
      await client.query("DELETE FROM resource_graph_nodes");
      for (const node of input.nodes.nodes) {
        await client.query(
          `INSERT INTO resource_graph_nodes(
             uid, import_id, kind, name, source_class, source_label,
             document_json, source_selection_json, imported_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
          [
            node.uid,
            importId,
            node.kind,
            node.name,
            node.source.class,
            node.source.label || null,
            JSON.stringify(node),
            JSON.stringify(sourcePlans.get(node.source.label || node.name) || null),
            importedAt,
          ],
        );
      }
      for (const edge of input.edges.edges) {
        await client.query(
          `INSERT INTO resource_graph_edges(
             from_uid, to_uid, kind, from_kind, to_kind, import_id, document_json, imported_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            edge.fromUid,
            edge.toUid,
            edge.kind,
            edge.fromKind,
            edge.toKind,
            importId,
            JSON.stringify(edge),
            importedAt,
          ],
        );
      }
      for (const document of runtimeEvidence) {
        await client.query(
          `INSERT INTO resource_graph_runtime_evidence(
             kind, name, source_class, source_label, document_json, imported_at
           ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
          [
            document.kind,
            document.id,
            document.source.class,
            document.source.label || null,
            JSON.stringify(document),
            importedAt,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
  return { importId, importedAt };
}

export async function readBackendResourceGraphIndex(
  backend: NixosSharedHostControlPlaneBackendTarget,
) {
  const [nodes, edges, imports] = await Promise.all([
    queryBackend<ResourceGraphNodeRow>(
      backend,
      "SELECT document_json, source_selection_json FROM resource_graph_nodes ORDER BY kind, name, uid",
    ),
    queryBackend<ResourceGraphEdgeRow>(
      backend,
      "SELECT document_json FROM resource_graph_edges ORDER BY from_uid, kind, to_uid",
    ),
    queryBackend<ResourceGraphImportCountRow>(
      backend,
      "SELECT COUNT(*) AS count FROM resource_graph_imports",
    ),
  ]);
  const intentNodes = nodes.rows.map((row) => ({
    ...decodeBackendJson<Record<string, unknown>>(row.document_json),
    ...(row.source_selection_json
      ? { sourceSelection: decodeBackendJson(row.source_selection_json) }
      : {}),
  }));
  const intentEdges = edges.rows.map((row) => decodeBackendJson(row.document_json));
  const runtime = await readRuntimeResourceGraph(backend, intentNodes as never, {
    intentGraphImported: Number(imports.rows[0]?.count || 0) > 0,
  });
  return redactControlPlaneReadModel({
    schemaVersion: "control-plane-resource-graph@1",
    nodes: [...intentNodes, ...runtime.nodes],
    edges: [...intentEdges, ...runtime.edges],
    runtime: runtime.status,
    tables: controlPlaneTableClassification(),
  });
}

async function writeImport(
  client: BackendQueryable,
  input: ResourceGraphReadModelInput,
  importId: string,
  importedAt: string,
) {
  await client.query(
    `INSERT INTO resource_graph_imports(
       import_id, source_ref, node_count, edge_count, document_json, imported_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (import_id) DO UPDATE SET
       source_ref = EXCLUDED.source_ref,
       node_count = EXCLUDED.node_count,
       edge_count = EXCLUDED.edge_count,
       document_json = EXCLUDED.document_json,
       imported_at = EXCLUDED.imported_at`,
    [
      importId,
      input.sourceRef,
      input.nodes.nodes.length,
      input.edges.edges.length,
      JSON.stringify({ sourceRef: input.sourceRef, apiVersion: input.nodes.apiVersion }),
      importedAt,
    ],
  );
}

function sourcePlanIndex(sourcePlans: SourcePlanEvidence[]) {
  return new Map(sourcePlans.map((plan) => [plan.target, plan]));
}

function importIdFor(
  sourceRef: string,
  nodes: ResourceGraphNodeDocument,
  edges: ResourceGraphEdgeDocument,
) {
  return `resource-graph:${crypto
    .createHash("sha256")
    .update(JSON.stringify({ sourceRef, nodes, edges }))
    .digest("hex")
    .slice(0, 24)}`;
}
