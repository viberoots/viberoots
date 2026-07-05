#!/usr/bin/env zx-wrapper
import type { ResourceGraphEdge, ResourceGraphNode } from "./resource-graph-export";
import { ADMITTED_RUNTIME_SOURCE_LABEL } from "./resource-graph-types";
import type { WorkerEvidence } from "./control-plane-worker-evidence";

const runtimeSource = { class: "runtime" as const, label: ADMITTED_RUNTIME_SOURCE_LABEL };

export function workerRuntimeGraph(workers: WorkerEvidence[]): {
  nodes: ResourceGraphNode[];
  edges: ResourceGraphEdge[];
} {
  const nodes = workers.map((worker) => ({
    uid: workerUid(worker.workerId),
    kind: "WorkerEvidence",
    name: worker.workerId,
    source: runtimeSource,
    labels: { "viberoots.dev/authority": "observed_runtime" },
    statusRef: `status:${workerUid(worker.workerId)}`,
    evidenceRef: `evidence:${workerUid(worker.workerId)}`,
    facts: worker,
  })) as ResourceGraphNode[];
  return {
    nodes,
    edges: workers.flatMap(workerEdges),
  };
}

function workerEdges(worker: WorkerEvidence): ResourceGraphEdge[] {
  const fromUid = workerUid(worker.workerId);
  return worker.leaseClaims.flatMap((claim) => [
    ...(claim.deployRunId
      ? [
          {
            fromUid,
            toUid: `runtime:DeployRun:${claim.deployRunId}`,
            kind: "runtime_status",
            fromKind: "WorkerEvidence",
            toKind: "DeployRun",
          } as ResourceGraphEdge,
        ]
      : []),
    {
      fromUid,
      toUid: `runtime:ExecutionSnapshot:${claim.submissionId}`,
      kind: "runtime_status",
      fromKind: "WorkerEvidence",
      toKind: "ExecutionSnapshot",
    } as ResourceGraphEdge,
  ]);
}

function workerUid(workerId: string) {
  return `runtime:WorkerEvidence:${workerId}`;
}
