#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";

const RUNTIME_EVIDENCE_KINDS = [
  "AuthProviderProfile",
  "ControlPlaneObservabilityEvidence",
  "ControlPlaneReadinessEvidence",
  "MiniMigrationPreflightEvidence",
  "RuntimeInput",
];

export function assertEvidenceKinds(model: any) {
  assert.deepEqual(evidenceKinds(model), RUNTIME_EVIDENCE_KINDS);
}

export function assertEvidenceReferenceSummary(model: any, expected: unknown) {
  assert.deepEqual(evidenceReferenceSummary(model), expected);
}

export function assertEvidenceReferenceShape(summary: any[], deploymentId: string) {
  assert.equal(summary.length, RUNTIME_EVIDENCE_KINDS.length);
  for (const item of summary) {
    assert.match(item.evidenceRef, /^evidence:runtime:/);
    assert.match(
      item.durableEvidenceRef,
      /^evidence:\/\/control-plane\/cloudflare-pages\/snapshots\/cp-[^/]+\//,
    );
    assert.match(item.sourceSnapshot.submissionId, /^cp-/);
    assert.ok(String(item.sourceSnapshot.executionSnapshotPath || "").length > 0);
    assert.deepEqual(item.resourceGraphRefs, [deploymentId]);
  }
}

export function assertRenderedEvidenceHtml(html: string, summary: any[], deploymentId: string) {
  for (const item of summary) {
    assertHtmlIncludes(html, item.kind);
    assertHtmlIncludes(html, item.evidenceRef);
    assertHtmlIncludes(html, item.durableEvidenceRef);
    assertHtmlIncludes(html, deploymentId);
    assertHtmlIncludes(html, item.sourceSnapshot.submissionId);
    assertHtmlIncludes(html, item.sourceSnapshot.executionSnapshotPath);
  }
}

export function evidenceKinds(model: any) {
  return model.nodes
    .map((node: any) => node.kind)
    .filter((kind: string) => RUNTIME_EVIDENCE_KINDS.includes(kind))
    .sort();
}

export function evidenceReferenceSummary(model: any) {
  return model.nodes
    .filter((node: any) => RUNTIME_EVIDENCE_KINDS.includes(node.kind))
    .map((node: any) => ({
      kind: node.kind,
      evidenceRef: String(node.evidenceRef || ""),
      durableEvidenceRef: String(node.facts?.value?.evidenceRef || ""),
      sourceSnapshot: node.facts?.value?.sourceSnapshot || {},
      resourceGraphRefs: node.facts?.resourceGraphRefs || [],
    }))
    .sort((a: any, b: any) => a.kind.localeCompare(b.kind));
}

function assertHtmlIncludes(html: string, value: string) {
  assert.match(html, new RegExp(escapeRegExp(value)));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function captureStdout(fn: () => Promise<void>) {
  const lines: string[] = [];
  const original = console.log;
  console.log = (value?: unknown) => lines.push(String(value ?? ""));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

export function assertSecretSafe(value: unknown) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /service-secret-token|raw-secret|Bearer|VBR_WORKER_OIDC_TOKEN|\/artifact-[ab]\b/,
  );
}
