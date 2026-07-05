#!/usr/bin/env zx-wrapper
import type { ResourceGraphEdge } from "./resource-graph-export";

export type RuntimePolicyContext = {
  policyUidByResourceId: Map<string, string>;
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
    const policyUid = opts.context.policyUidByResourceId.get(ref.resourceId);
    return policyUid
      ? [
          {
            fromUid: opts.fromUid,
            toUid: policyUid,
            kind: "policy",
            fromKind: opts.fromKind,
            toKind: ref.kind,
          } as ResourceGraphEdge,
        ]
      : [];
  });
}
