#!/usr/bin/env zx-wrapper
import { createHash } from "node:crypto";
import { validateRuntimeEvidenceObject } from "./resource-graph-runtime-owned-validators";
import { runtimeEvidenceValidationProof } from "./resource-graph-runtime-reference";

export function snapshotRuntimeEvidenceReference(opts: {
  value: unknown;
  kind: string;
  submissionId: string;
  deploymentId: string;
  evidenceKind: string;
  evidenceSchemaVersion: string;
  ownedEvidence: unknown;
}) {
  const value = opts.value as Record<string, unknown>;
  const evidenceRef = `evidence://control-plane/cloudflare-pages/snapshots/${encodeURIComponent(
    opts.submissionId,
  )}/${opts.kind}`;
  const sourceSnapshot = { submissionId: opts.submissionId };
  const ownedRecord = opts.ownedEvidence as Record<string, unknown>;
  const checkedAt = String(ownedRecord.checkedAt || "");
  const ownedErrors = validateRuntimeEvidenceObject(opts.ownedEvidence, {
    evidenceKind: opts.evidenceKind,
    evidenceSchemaVersion: opts.evidenceSchemaVersion,
    deploymentId: opts.deploymentId,
    maxAgeMinutes: 60,
    nowMs: Date.parse(checkedAt) + 1000,
  });
  if (ownedErrors.length > 0) {
    throw new Error(`runtime evidence authority validation failed: ${ownedErrors.join("; ")}`);
  }
  const durableRecord = runtimeEvidenceValidationProof({
    evidenceKind: opts.evidenceKind,
    evidenceSchemaVersion: opts.evidenceSchemaVersion,
    referenceSchemaVersion: String(value.schemaVersion || ""),
    evidenceRef,
    deploymentId: opts.deploymentId,
    sourceSnapshot,
    checkedAt,
    provider: String(ownedRecord.owningProvider || ""),
    controlPlaneProfileId: String(ownedRecord.owningControlPlaneProfileId || ""),
    validatedEvidenceDigest: digest(opts.ownedEvidence),
  });
  return {
    value: {
      ...value,
      evidenceRef,
      sourceSnapshot,
      controlPlaneProfileId: durableRecord.controlPlaneProfileId,
    },
    durableRecord,
  };
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function proofWithSnapshotPath(value: unknown, executionSnapshotPath: string) {
  if (!value || typeof value !== "object") return value;
  const proof = value as Record<string, unknown>;
  const sourceSnapshot = proof.sourceSnapshot as Record<string, unknown> | undefined;
  return {
    ...proof,
    sourceSnapshot: { ...sourceSnapshot, executionSnapshotPath },
  };
}
