#!/usr/bin/env zx-wrapper
import { fingerprintControlPlanePayload } from "./deployment-control-plane-idempotency";
import { resolveBackendIdempotency } from "./nixos-shared-host-control-plane-backend";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";

type ProviderSubmissionSnapshot = {
  schemaVersion: string;
  submissionId: string;
  operationKind: string;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  lockScope: string;
  artifact?: { identity?: string; artifactIdentity?: string; digest?: string };
  componentArtifacts?: Array<{ componentId: string; identity: string }>;
  replaySnapshot?: { deployRunId?: string; providerTargetIdentity?: string };
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  expectedSourceRevision?: string;
  sourceRunId?: string;
  smokeConnectOverride?: unknown;
  admittedContext?: { source?: unknown; artifactIdentity?: string };
};

function artifactIdentity(snapshot: ProviderSubmissionSnapshot) {
  return (
    snapshot.artifactLineageId ||
    snapshot.artifact?.identity ||
    snapshot.artifact?.artifactIdentity ||
    snapshot.artifact?.digest ||
    snapshot.admittedContext?.artifactIdentity
  );
}

function normalizedComponentArtifacts(snapshot: ProviderSubmissionSnapshot) {
  return (snapshot.componentArtifacts || []).map((artifact) => ({
    componentId: artifact.componentId,
    identity: artifact.identity,
  }));
}

export function fingerprintProviderSubmissionPayload(snapshot: ProviderSubmissionSnapshot) {
  return fingerprintControlPlanePayload({
    schemaVersion: snapshot.schemaVersion,
    operationKind: snapshot.operationKind,
    deploymentId: snapshot.deploymentId,
    deploymentLabel: snapshot.deploymentLabel,
    providerTargetIdentity: snapshot.providerTargetIdentity,
    lockScope: snapshot.lockScope,
    artifactIdentity: artifactIdentity(snapshot),
    componentArtifacts: normalizedComponentArtifacts(snapshot),
    parentRunId: snapshot.parentRunId,
    releaseLineageId: snapshot.releaseLineageId,
    sourceRunId: snapshot.sourceRunId,
    expectedSourceRevision: snapshot.expectedSourceRevision,
    replaySourceRunId: snapshot.replaySnapshot?.deployRunId,
    replayProviderTargetIdentity: snapshot.replaySnapshot?.providerTargetIdentity,
    admittedSource: snapshot.admittedContext?.source,
    smokeConnectOverride: snapshot.smokeConnectOverride,
  });
}

export async function resolveProviderSubmitIdempotency(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  snapshot: ProviderSubmissionSnapshot;
}) {
  const requestFingerprint = fingerprintProviderSubmissionPayload(opts.snapshot);
  const idempotencyKey = `provider-submit:${requestFingerprint}`;
  const dedupe = await resolveBackendIdempotency({
    backend: opts.backend,
    kind: "submit",
    key: idempotencyKey,
    requestFingerprint,
    targetId: opts.snapshot.submissionId,
  });
  return {
    ...dedupe,
    mode: dedupe.mode === "reused" ? ("duplicate" as const) : dedupe.mode,
    requestFingerprint,
    idempotencyKey,
  };
}
