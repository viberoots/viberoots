#!/usr/bin/env zx-wrapper
import {
  isAdmittedControlPlaneRuntimeRecord,
  type DeploymentResourceInventoryEntry,
  type RuntimeStatusRecord,
} from "./resource-graph-types";

const SECRET_FIELDS = ["token", "rawToken", "secret", "proof", "nonce"];

export function collectRuntimeArtifactStatus(
  out: DeploymentResourceInventoryEntry[],
  errors: string[],
  opts: {
    artifactChallenges?: RuntimeStatusRecord[];
    uploadSessions?: RuntimeStatusRecord[];
    artifactBindingProvenance?: RuntimeStatusRecord[];
    cleanupEvidence?: RuntimeStatusRecord[];
    artifactCleanupJanitorRecords?: RuntimeStatusRecord[];
  },
) {
  collectStatus(out, errors, "ArtifactChallenge", opts.artifactChallenges, [
    "challengeId",
    "deploymentId",
    "proofKeyId",
    "issuedAt",
    "nonceValidationOutcome",
    "proofKeyValidationOutcome",
    "oneTimeConsumption",
    "admittedProvenance",
    "status",
  ]);
  collectStatus(out, errors, "StaticWebappUploadSession", opts.uploadSessions, [
    "uploadSessionId",
    "submissionId",
    "archiveFormat",
    "archivePath",
    "objectIdentity",
    "digest",
    "sizeBytes",
    "expiresAt",
    "provenance",
  ]);
  collectStatus(out, errors, "StagedArtifact", opts.uploadSessions, [
    "uploadSessionId",
    "objectIdentity",
    "digest",
    "sizeBytes",
    "provenance",
  ]);
  collectStatus(out, errors, "ArtifactBindingProvenance", opts.artifactBindingProvenance, [
    "challengeId",
    "proofKeyId",
    "canonicalEnvelopeFingerprint",
    "admittedArtifactRef",
    "decision",
  ]);
  collectStatus(out, errors, "CleanupEvidence", opts.cleanupEvidence, [
    "recordId",
    "status",
    "diagnostics",
  ]);
  collectStatus(out, errors, "CleanupEvidence", opts.artifactCleanupJanitorRecords, [
    "recordId",
    "reason",
    "createdAt",
    "documentJson",
  ]);
}

function collectStatus(
  out: DeploymentResourceInventoryEntry[],
  errors: string[],
  kind: DeploymentResourceInventoryEntry["kind"],
  records: RuntimeStatusRecord[] | undefined,
  required: string[],
) {
  for (const record of records || []) {
    if (!isAdmittedControlPlaneRuntimeRecord(record)) {
      errors.push(`${kind} ${record.id}: runtime source is not an admitted control-plane record`);
      continue;
    }
    const missing = required.filter((field) => !fieldPresent(record.facts[field]));
    const forbidden = SECRET_FIELDS.filter((field) => record.facts[field] !== undefined);
    const semanticErrors = semanticStatusErrors(kind, record);
    if (missing.length || forbidden.length || semanticErrors.length) {
      errors.push(
        `${kind} ${record.id}: invalid runtime source (${[
          missing.length ? `missing ${missing.join(", ")}` : "",
          forbidden.length ? `forbidden secret fields ${forbidden.join(", ")}` : "",
          ...semanticErrors,
        ]
          .filter(Boolean)
          .join("; ")})`,
      );
      continue;
    }
    out.push({
      kind,
      id: record.id,
      authority: "observed_runtime",
      source: record.source!,
      ...(record.refs ? { refs: record.refs } : {}),
      facts: record.facts,
    });
  }
}

function semanticStatusErrors(
  kind: DeploymentResourceInventoryEntry["kind"],
  record: RuntimeStatusRecord,
): string[] {
  const facts = record.facts;
  const errors: string[] = [];
  if (
    kind === "StaticWebappUploadSession" &&
    facts.provenance !== `upload-session:${facts.uploadSessionId}`
  ) {
    errors.push("provenance must be upload-session:<id>");
  }
  if (kind === "ArtifactChallenge" && facts.status !== "accepted" && !facts.failureDiagnostics) {
    errors.push("rejected challenge requires failureDiagnostics");
  }
  if (
    kind === "CleanupEvidence" &&
    !facts.documentJson &&
    facts.status !== "passed" &&
    !facts.diagnostics
  ) {
    errors.push("rejected cleanup requires diagnostics");
  }
  if (kind === "CleanupEvidence" && facts.documentJson) {
    errors.push(...janitorDocumentErrors(facts.documentJson));
  }
  return errors;
}

function janitorDocumentErrors(value: unknown): string[] {
  const document = value as Record<string, unknown>;
  if (document.schemaVersion !== "nixos-shared-host-staged-artifact-janitor@1") {
    return ["janitor document schemaVersion invalid"];
  }
  return [
    document.reason ? "" : "janitor document reason is required",
    document.stagedReference ? "" : "janitor document stagedReference is required",
    document.cleanupError ? "" : "janitor document cleanupError is required",
  ].filter(Boolean);
}

function fieldPresent(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  return String(value || "").trim().length > 0;
}
