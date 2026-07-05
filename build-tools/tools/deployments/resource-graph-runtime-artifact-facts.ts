#!/usr/bin/env zx-wrapper

export function challengeFacts(id: string, row: any, binding: any) {
  const consumed = Boolean(row.used_at);
  return {
    challengeId: id,
    deploymentId: binding.request?.deployment?.deploymentId || binding.request?.deploymentId,
    principalId: row.principal_id,
    proofKeyId: row.key_id,
    expiresAtMs: row.expires_at_ms,
    status: consumed ? "accepted" : "issued",
    nonceValidationOutcome: consumed ? "matched-redacted-nonce-digest" : "pending",
    proofKeyValidationOutcome: consumed ? "trusted-key" : "pending",
    oneTimeConsumption: consumed ? "consumed-once" : "not-yet-consumed",
    admittedProvenance:
      binding.finalizedStagedArtifactReference || binding.request?.artifactIdentity || "pending",
    ...(!consumed ? { failureDiagnostics: "not yet consumed" } : {}),
    binding,
  };
}

export function uploadSessionFacts(id: string, row: any, doc: any) {
  return {
    uploadSessionId: id,
    submissionId: row.submission_id,
    archiveFormat: doc.archiveFormat,
    archivePath: doc.archivePath,
    objectIdentity: doc.archiveObject?.key,
    digest: doc.archiveDigest || doc.digest,
    sizeBytes: doc.sizeBytes,
    expiresAt: row.expires_at,
    provenance: `upload-session:${id}`,
    document: doc,
  };
}

export function cleanupFacts(id: string, row: any, doc: any) {
  return {
    recordId: id,
    submissionId: row.submission_id,
    deploymentId: row.deployment_id,
    reason: row.reason,
    status: "rejected",
    diagnostics: doc.cleanupError,
    documentJson: doc,
    createdAt: row.created_at,
  };
}

export function artifactFacts(id: string, row: any) {
  return {
    objectKey: id,
    bucket: row.bucket,
    digest: row.digest,
    sizeBytes: row.size_bytes,
    contentType: row.content_type,
    provenance: row.provenance,
  };
}
