#!/usr/bin/env zx-wrapper
import type { RuntimeSourceRecord } from "./resource-graph-types";

export const RUNTIME_EVIDENCE_VALIDATION_PROOF_SCHEMA = "runtime-evidence-validation-proof@1";

export type RuntimeEvidenceDurableRecord = ReturnType<typeof runtimeEvidenceValidationProof>;

type ReferenceValidationOptions = {
  evidenceKind: string;
  evidenceSchemaVersion: string;
  validateResolved?: (value: unknown) => string[];
};

export function validateEvidenceReference(
  value: unknown,
  record: RuntimeSourceRecord,
  schemaVersion: string,
  label: string,
  opts: ReferenceValidationOptions,
): string[] | null {
  if (!value || typeof value !== "object") return null;
  const evidence = value as Record<string, unknown>;
  if (evidence.schemaVersion !== schemaVersion) return null;
  const nowMs = Number(record.validation?.nowMs || Date.now());
  const checkedAt = parseTime(evidence.checkedAt);
  const maxAgeMinutes = Number(record.validation?.maxAgeMinutes || 60);
  const sourceSnapshot = evidence.sourceSnapshot as Record<string, unknown> | undefined;
  const submissionId = String(sourceSnapshot?.submissionId || "");
  const executionSnapshotPath = String(sourceSnapshot?.executionSnapshotPath || "");
  const expectedPrefix = `evidence://control-plane/cloudflare-pages/snapshots/${encodeURIComponent(
    submissionId,
  )}/`;
  const evidenceRef = String(evidence.evidenceRef || "").trim();
  return [
    ...(evidenceRef ? [] : [`${label} evidenceRef is required`]),
    ...(submissionId ? [] : [`${label} source snapshot submissionId is required`]),
    ...(executionSnapshotPath
      ? []
      : [`${label} source snapshot executionSnapshotPath is required`]),
    ...(submissionId && evidenceRef.startsWith(expectedPrefix)
      ? []
      : [`${label} evidenceRef does not match source snapshot`]),
    ...(Number.isFinite(checkedAt) ? [] : [`${label} checkedAt is missing or invalid`]),
    ...(Number.isFinite(checkedAt) && nowMs - checkedAt > maxAgeMinutes * 60_000
      ? [`${label} evidence is stale`]
      : []),
    ...validateReferenceAuthority(evidence, record, opts, label, schemaVersion),
  ];
}

export function validateReadinessReference(
  value: unknown,
  record: RuntimeSourceRecord,
  validateResolved?: (value: unknown) => string[],
) {
  const errors = validateEvidenceReference(
    value,
    record,
    "control-plane-readiness-reference@1",
    "readiness",
    {
      evidenceKind: "ControlPlaneReadinessEvidence",
      evidenceSchemaVersion: "cloud-cutover-evidence@1",
      validateResolved,
    },
  );
  if (!errors) return null;
  const evidence = value as Record<string, unknown>;
  return [
    ...errors,
    ...(String(evidence.operation || "") === String(record.validation?.operation || "cutover")
      ? []
      : ["readiness operation does not match"]),
  ];
}

export function runtimeEvidenceValidationProof(opts: {
  evidenceKind: string;
  evidenceSchemaVersion: string;
  referenceSchemaVersion: string;
  evidenceRef: string;
  deploymentId: string;
  sourceSnapshot: { submissionId: string; executionSnapshotPath?: string };
  checkedAt: string;
  provider?: string;
  controlPlaneProfileId?: string;
  validatedEvidenceDigest?: string;
}) {
  return {
    schemaVersion: RUNTIME_EVIDENCE_VALIDATION_PROOF_SCHEMA,
    evidenceKind: opts.evidenceKind,
    evidenceSchemaVersion: opts.evidenceSchemaVersion,
    referenceSchemaVersion: opts.referenceSchemaVersion,
    evidenceRef: opts.evidenceRef,
    deploymentId: opts.deploymentId,
    sourceSnapshot: opts.sourceSnapshot,
    provider: opts.provider,
    controlPlaneProfileId: opts.controlPlaneProfileId,
    validatedAt: opts.checkedAt,
    validator: "control-plane-runtime-evidence",
    validatedEvidenceDigest: opts.validatedEvidenceDigest,
  };
}

function validateReferenceAuthority(
  evidence: Record<string, unknown>,
  record: RuntimeSourceRecord,
  opts: ReferenceValidationOptions,
  label: string,
  referenceSchemaVersion: string,
) {
  const authorityErrors = validateReferenceAuthorityFields(evidence, record, label);
  const resolved = evidence.resolvedEvidence;
  if (resolved !== undefined) {
    const errors = opts.validateResolved ? opts.validateResolved(resolved) : [];
    return [...authorityErrors, ...errors.map((error) => `${label} resolved evidence ${error}`)];
  }
  const proof = durableRecordFor(record, String(evidence.evidenceRef || ""));
  if (!proof) return [`${label} durable evidence record is unresolved`];
  const evidenceRef = String(evidence.evidenceRef || "");
  const sourceSnapshot = evidence.sourceSnapshot as Record<string, unknown> | undefined;
  const proofSnapshot = proof.sourceSnapshot as Record<string, unknown> | undefined;
  const deploymentIds = new Set([
    ...(record.refs || []),
    ...(record.validation?.deploymentIds || []),
  ]);
  const validatedAt = parseTime(proof.validatedAt);
  const maxAgeMinutes = Number(record.validation?.maxAgeMinutes || 60);
  const nowMs = Number(record.validation?.nowMs || Date.now());
  return [
    ...authorityErrors,
    ...(proof.schemaVersion === RUNTIME_EVIDENCE_VALIDATION_PROOF_SCHEMA
      ? []
      : [`${label} validation proof schemaVersion invalid`]),
    ...(proof.evidenceKind === opts.evidenceKind
      ? []
      : [`${label} validation proof kind mismatch`]),
    ...(proof.evidenceSchemaVersion === opts.evidenceSchemaVersion
      ? []
      : [`${label} validation proof evidence schemaVersion mismatch`]),
    ...(proof.referenceSchemaVersion === referenceSchemaVersion
      ? []
      : [`${label} validation proof reference schemaVersion mismatch`]),
    ...(proof.evidenceRef === evidenceRef ? [] : [`${label} validation proof ref mismatch`]),
    ...(deploymentIds.has(String(proof.deploymentId || ""))
      ? []
      : [`${label} validation proof deployment mismatch`]),
    ...(proofSnapshot?.submissionId === sourceSnapshot?.submissionId
      ? []
      : [`${label} validation proof source snapshot mismatch`]),
    ...(proofSnapshot?.executionSnapshotPath === sourceSnapshot?.executionSnapshotPath
      ? []
      : [`${label} validation proof execution snapshot mismatch`]),
    ...validateProofAuthority(evidence, record, proof, label),
    ...(proof.provider || proof.controlPlaneProfileId
      ? []
      : [`${label} validation proof authority identity is required`]),
    ...(Number.isFinite(validatedAt)
      ? []
      : [`${label} validation proof timestamp is missing or invalid`]),
    ...(Number.isFinite(validatedAt) && nowMs - validatedAt > maxAgeMinutes * 60_000
      ? [`${label} validation proof is stale`]
      : []),
  ];
}

function validateReferenceAuthorityFields(
  evidence: Record<string, unknown>,
  record: RuntimeSourceRecord,
  label: string,
) {
  const provider = String(evidence.provider || "");
  const profile = String(evidence.controlPlaneProfileId || "");
  const expectedProvider = String(record.validation?.expectedProvider || "");
  const expectedProfile = String(record.validation?.expectedControlPlaneProfileId || "");
  return [
    ...(expectedProvider && provider !== expectedProvider
      ? [`${label} reference provider mismatch`]
      : []),
    ...(expectedProfile && profile !== expectedProfile
      ? [`${label} reference control-plane profile mismatch`]
      : []),
  ];
}

function validateProofAuthority(
  evidence: Record<string, unknown>,
  record: RuntimeSourceRecord,
  proof: RuntimeEvidenceDurableRecord,
  label: string,
) {
  const provider = String(evidence.provider || "");
  const profile = String(evidence.controlPlaneProfileId || "");
  const expectedProvider = String(record.validation?.expectedProvider || "");
  const expectedProfile = String(record.validation?.expectedControlPlaneProfileId || "");
  return [
    ...(provider && proof.provider !== provider
      ? [`${label} validation proof provider mismatch`]
      : []),
    ...(expectedProvider && proof.provider !== expectedProvider
      ? [`${label} validation proof expected provider mismatch`]
      : []),
    ...(profile && proof.controlPlaneProfileId !== profile
      ? [`${label} validation proof control-plane profile mismatch`]
      : []),
    ...(expectedProfile && proof.controlPlaneProfileId !== expectedProfile
      ? [`${label} validation proof expected control-plane profile mismatch`]
      : []),
  ];
}

function durableRecordFor(record: RuntimeSourceRecord, evidenceRef: string) {
  const records = record.validation?.runtimeEvidenceRecords;
  if (!Array.isArray(records)) return undefined;
  return records.find(
    (item): item is RuntimeEvidenceDurableRecord =>
      !!item && typeof item === "object" && (item as any).evidenceRef === evidenceRef,
  );
}

function parseTime(value: unknown) {
  return Date.parse(String(value || ""));
}
