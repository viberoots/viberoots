#!/usr/bin/env zx-wrapper
import { REVIEWED_PROVIDER_IDS } from "./deployment-provider-capabilities";

type EvidenceField =
  | "liveTargetIdentity"
  | "lastKnownProviderReleaseId"
  | "driftSignal"
  | "previewTargetEvidence"
  | "partialPublishEvidence"
  | "smokeReadinessEvidence"
  | "rollbackRecoveryEvidence";

type EvidenceSupport = "supported" | "unsupported" | "deferred";

export type ProviderEvidenceMatrixEntry = {
  provider: string;
  fields: Record<EvidenceField, EvidenceSupport>;
};

const BASE_FIELDS: Record<EvidenceField, EvidenceSupport> = {
  liveTargetIdentity: "supported",
  lastKnownProviderReleaseId: "supported",
  driftSignal: "unsupported",
  previewTargetEvidence: "unsupported",
  partialPublishEvidence: "supported",
  smokeReadinessEvidence: "supported",
  rollbackRecoveryEvidence: "supported",
};

const OVERRIDES: Record<string, Partial<Record<EvidenceField, EvidenceSupport>>> = {
  "app-store-connect": { driftSignal: "deferred", previewTargetEvidence: "unsupported" },
  "cloudflare-containers": {
    lastKnownProviderReleaseId: "deferred",
    previewTargetEvidence: "deferred",
    rollbackRecoveryEvidence: "deferred",
  },
  "cloudflare-pages": { previewTargetEvidence: "supported" },
  "google-play": { driftSignal: "deferred", previewTargetEvidence: "unsupported" },
  kubernetes: { driftSignal: "deferred", previewTargetEvidence: "deferred" },
  "nixos-shared-host": { previewTargetEvidence: "unsupported" },
  opentofu: {
    lastKnownProviderReleaseId: "unsupported",
    previewTargetEvidence: "unsupported",
    partialPublishEvidence: "unsupported",
    smokeReadinessEvidence: "unsupported",
    rollbackRecoveryEvidence: "deferred",
  },
  "s3-static": { previewTargetEvidence: "unsupported" },
  vercel: { previewTargetEvidence: "supported" },
};

export function providerEvidenceMatrix(): ProviderEvidenceMatrixEntry[] {
  return REVIEWED_PROVIDER_IDS.map((provider) => ({
    provider,
    fields: { ...BASE_FIELDS, ...(OVERRIDES[provider] || {}) },
  }));
}

export function providerEvidenceMatrixEntry(provider: string): ProviderEvidenceMatrixEntry {
  const entry = providerEvidenceMatrix().find((candidate) => candidate.provider === provider);
  if (!entry) throw new Error(`provider evidence matrix missing reviewed provider: ${provider}`);
  return entry;
}

export function assertProviderEvidenceFieldSupported(provider: string, field: EvidenceField) {
  const support = providerEvidenceMatrixEntry(provider).fields[field];
  if (support !== "supported") {
    throw new Error(`${provider}: provider evidence field ${field} is ${support}`);
  }
}

export function providerFromTargetIdentity(identity: string): string {
  return identity.includes(":") ? identity.split(":")[0] : "unknown";
}

export function normalizeProviderEvidenceFacts(record: Record<string, unknown>) {
  const provider = String(
    record.provider || providerFromTargetIdentity(String(record.providerTargetIdentity || "")),
  );
  const matrix = providerEvidenceMatrixEntry(provider);
  return {
    provider,
    providerEvidenceMatrixVersion: "provider-evidence-matrix@1",
    support: matrix.fields,
    liveTargetIdentity: record.providerTargetIdentity || record.deploymentId,
    lastKnownProviderReleaseId: supportedValue(
      matrix,
      "lastKnownProviderReleaseId",
      record.providerReleaseId || record.releaseId,
    ),
    driftSignal: supportedValue(matrix, "driftSignal", record.driftSignal),
    previewTargetEvidence: supportedValue(matrix, "previewTargetEvidence", record.previewTarget),
    partialPublishEvidence: supportedValue(matrix, "partialPublishEvidence", {
      finalOutcome: record.finalOutcome || "unknown",
      failedStep: record.failedStep || "none",
      publishMode: record.publishMode || "normal",
    }),
    smokeReadinessEvidence: supportedValue(
      matrix,
      "smokeReadinessEvidence",
      record.smokeOutcome || record.smoke,
    ),
    rollbackRecoveryEvidence: supportedValue(
      matrix,
      "rollbackRecoveryEvidence",
      record.operationKind === "rollback" ? "rollback-run" : "not-applicable",
    ),
    ...(hasSourcePlanEvidence(record, matrix)
      ? { sourcePlanRef: (record.admittedContext as any).sourcePlanRef }
      : {}),
  };
}

function supportedValue(
  matrix: ProviderEvidenceMatrixEntry,
  field: EvidenceField,
  value: unknown,
): unknown {
  return matrix.fields[field] === "supported" ? value || "not-recorded" : matrix.fields[field];
}

function hasSourcePlanEvidence(
  record: Record<string, unknown>,
  matrix: ProviderEvidenceMatrixEntry,
): boolean {
  return (
    typeof (record.admittedContext as any)?.sourcePlanRef === "string" &&
    Boolean(
      record.executionSnapshotSubmissionId ||
        record.executionSnapshotPath ||
        record.artifactIdentity ||
        record.builtArtifactIdentity ||
        (matrix.fields.lastKnownProviderReleaseId === "supported" && record.providerReleaseId),
    )
  );
}
