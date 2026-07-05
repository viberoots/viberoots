#!/usr/bin/env zx-wrapper
import type { ResourceGraphEdge } from "./resource-graph-export";

export type RuntimePolicyContext = {
  policyByResourceId: Map<string, { uid: string; version?: string }>;
};

export type RuntimePolicyRef = {
  kind: string;
  resourceId: string;
  version: string;
};

export function policyResourceRefs(doc: any): RuntimePolicyRef[] {
  const refs =
    doc?.admittedContext?.policyEvaluation?.policyResourceRefs ||
    doc?.admittedContext?.policyResourceRefs ||
    doc?.policyEvaluation?.policyResourceRefs ||
    doc?.policyResourceRefs ||
    [];
  return Array.isArray(refs) ? refs : [];
}

export function policyRuntimeEdges(opts: {
  refs: RuntimePolicyRef[];
  context: RuntimePolicyContext;
  fromUid: string;
  fromKind: string;
}): ResourceGraphEdge[] {
  return opts.refs.flatMap((ref) => {
    const policy = opts.context.policyByResourceId.get(ref.resourceId);
    if (!policy) throw new Error(`runtime policy ref missing resource: ${ref.resourceId}`);
    if (policy.version && policy.version !== ref.version) {
      throw new Error(
        `runtime policy ref version mismatch for ${ref.resourceId}: expected ${policy.version}, got ${ref.version}`,
      );
    }
    return [
      {
        fromUid: opts.fromUid,
        toUid: policy.uid,
        kind: "policy",
        fromKind: opts.fromKind,
        toKind: ref.kind,
      } as ResourceGraphEdge,
    ];
  });
}
