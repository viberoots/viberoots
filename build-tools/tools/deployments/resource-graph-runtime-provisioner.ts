#!/usr/bin/env zx-wrapper
import type { ResourceGraphEdge } from "./resource-graph-export";

export function provisionerRuntimeEdges(opts: {
  doc: any;
  toKind: string;
  to: string;
  provisionerUidByDeploymentId: Map<string, string>;
}): ResourceGraphEdge[] {
  const deploymentId = String(opts.doc?.deploymentId || "");
  if (!opts.doc?.provisionerPlan) return [];
  const fromUid = opts.provisionerUidByDeploymentId.get(deploymentId);
  if (!fromUid) {
    throw new Error(
      `unsupported provisioner runtime evidence for deployment without intent Provisioner: ${deploymentId}`,
    );
  }
  return fromUid
    ? [
        {
          fromUid,
          toUid: runtimeUid(opts.toKind, opts.to),
          kind: "runtime_status",
          fromKind: "Provisioner",
          toKind: opts.toKind,
        } as ResourceGraphEdge,
      ]
    : [];
}

export function retainedRenderEvidence(evidence: any[] | undefined): any[] {
  const allowed = "replay_snapshot,provider_config,provisioner_plan,execution_snapshot".split(",");
  return (evidence || []).map((entry) => {
    if (!allowed.includes(String(entry.kind))) {
      throw new Error(`unsupported retained render evidence kind: ${entry.kind}`);
    }
    return entry;
  });
}

function runtimeUid(kind: string, name: string) {
  return `runtime:${kind}:${name}`;
}
