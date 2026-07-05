#!/usr/bin/env zx-wrapper
import type { ResourceGraphEdge, ResourceGraphNode } from "./resource-graph-export";
import { RuntimeGraph } from "./resource-graph-runtime-graph";
import { latestRuntimeActions } from "./resource-graph-runtime-latest-actions";
import { readWorkerEvidence } from "./control-plane-worker-evidence";
import { runtimeEvidenceGraph } from "./resource-graph-runtime-evidence";
import { workerRuntimeGraph } from "./resource-graph-runtime-workers";
import {
  queryBackend,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend-db";

type JsonRow = Record<string, unknown>;

export type RuntimeReadModel = {
  indexed: true;
  status: "runtime-linked";
  nodeCount: number;
  edgeCount: number;
  latestActions: Array<{ submissionId: string; actionId: string; submittedAt: string }>;
  workerEvidenceCount: number;
  runtimeEvidenceCount: number;
};

export async function readRuntimeResourceGraph(
  backend: NixosSharedHostControlPlaneBackendTarget,
  intentNodes: ResourceGraphNode[],
): Promise<{ nodes: ResourceGraphNode[]; edges: ResourceGraphEdge[]; status: RuntimeReadModel }> {
  const context = contextFor(intentNodes);
  const [
    submissions,
    snapshots,
    records,
    actions,
    states,
    history,
    challenges,
    uploads,
    artifacts,
    cleanup,
    runtimeEvidence,
    workers,
  ] = await Promise.all([
    rows(backend, "SELECT submission_id, deploy_run_id, document_json FROM submissions"),
    rows(backend, "SELECT submission_id, execution_snapshot_path, document_json FROM snapshots"),
    rows(
      backend,
      "SELECT deploy_run_id, submission_id, record_path, document_json FROM deploy_records",
    ),
    rows(backend, "SELECT action_id, submission_id, action, request_json FROM run_actions"),
    rows(
      backend,
      "SELECT deployment_id, environment_stage, document_json FROM current_stage_state",
    ),
    rows(
      backend,
      "SELECT deployment_id, environment_stage, deploy_run_id, document_json FROM stage_state_history",
    ),
    rows(
      backend,
      "SELECT challenge_id, expires_at_ms, used_at, principal_id, key_id, binding_json FROM artifact_challenges",
    ),
    rows(
      backend,
      "SELECT upload_session_id, submission_id, document_json, expires_at FROM static_webapp_upload_sessions",
    ),
    rows(
      backend,
      "SELECT object_key, bucket, digest, size_bytes, content_type, provenance_json FROM artifact_objects",
    ),
    rows(
      backend,
      "SELECT record_id, submission_id, deployment_id, reason, document_json, created_at FROM artifact_cleanup_janitor_records",
    ),
    rows(
      backend,
      "SELECT kind, name, source_class, source_label, document_json FROM resource_graph_runtime_evidence ORDER BY kind, name",
    ),
    readWorkerEvidence(backend),
  ]);
  const graph = new RuntimeGraph(context, submissions);
  snapshots.forEach((row) => graph.snapshot(row));
  records.forEach((row) => graph.deployRun(row));
  actions.forEach((row) => graph.runAction(row));
  states.forEach((row) => graph.stageState(row));
  history.forEach((row) => graph.stageHistory(row));
  challenges.forEach((row) => graph.challenge(row));
  uploads.forEach((row) => graph.uploadSession(row));
  artifacts.forEach((row) => graph.artifact(row));
  cleanup.forEach((row) => graph.cleanup(row));
  const workerGraph = workerRuntimeGraph(workers);
  const evidenceGraph = runtimeEvidenceGraph(runtimeEvidence as never, context.deploymentUidById);
  return {
    nodes: [...graph.nodes, ...workerGraph.nodes, ...evidenceGraph.nodes],
    edges: [...graph.edges, ...workerGraph.edges, ...evidenceGraph.edges],
    status: {
      indexed: true,
      status: "runtime-linked",
      nodeCount: graph.nodes.length + workerGraph.nodes.length + evidenceGraph.nodes.length,
      edgeCount: graph.edges.length + workerGraph.edges.length + evidenceGraph.edges.length,
      latestActions: latestRuntimeActions(actions),
      workerEvidenceCount: workers.length,
      runtimeEvidenceCount: runtimeEvidence.length,
    },
  };
}

async function rows(backend: NixosSharedHostControlPlaneBackendTarget, sql: string) {
  return (await queryBackend<JsonRow>(backend, sql)).rows;
}

function contextFor(nodes: ResourceGraphNode[]) {
  return {
    deploymentUidById: uidMap(nodes, "Deployment"),
    providerTargetUidById: uidMap(nodes, "ProviderTarget"),
    provisionerUidByDeploymentId: uidMap(nodes, "Provisioner", (name) =>
      name.endsWith(":provisioner") ? name.slice(0, -":provisioner".length) : name,
    ),
    policyByResourceId: policyMap(nodes),
  };
}

function uidMap(nodes: ResourceGraphNode[], kind: string, key = (name: string) => name) {
  return new Map(
    nodes.filter((node) => node.kind === kind).map((node) => [key(node.name), node.uid]),
  );
}

function policyMap(nodes: ResourceGraphNode[]) {
  return new Map(
    nodes
      .filter((node) => node.kind.endsWith("Policy"))
      .map((node) => [
        node.name,
        {
          uid: node.uid,
          version:
            typeof (node.facts as any)?.policyResourceVersion === "string"
              ? (node.facts as any).policyResourceVersion
              : undefined,
        },
      ]),
  );
}
