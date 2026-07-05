#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import type { DeploymentResourceEnvelope } from "./resource-graph-envelope";
import type { ResourceGraphEdge, ResourceGraphNode } from "./resource-graph-export";

export function sourceNodesFor(envelopes: DeploymentResourceEnvelope[]): ResourceGraphNode[] {
  const byKey = new Map<string, ResourceGraphNode>();
  for (const envelope of envelopes) {
    const key = sourceKey(envelope.source);
    byKey.set(key, {
      uid: sourceUid(key),
      kind: "SourceMetadata",
      name: envelope.source.label || envelope.source.path || envelope.source.class,
      source: envelope.source,
      labels: { "viberoots.dev/source-class": envelope.source.class },
      statusRef: `status:${sourceUid(key)}`,
    });
  }
  return [...byKey.values()];
}

export function sourceEdge(envelope: DeploymentResourceEnvelope, toUid: string): ResourceGraphEdge {
  return {
    fromUid: envelope.metadata.uid,
    toUid,
    kind: "source",
    fromKind: envelope.kind,
    toKind: "SourceMetadata",
  };
}

export function sourceKey(source: DeploymentResourceEnvelope["source"]): string {
  return JSON.stringify({
    class: source.class,
    label: source.label,
    path: source.path || "",
  });
}

function sourceUid(key: string): string {
  return `uid:source:${crypto.createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}
