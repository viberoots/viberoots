#!/usr/bin/env zx-wrapper
import { resolveSourceRunCloudflarePagesAdmittedContext } from "./cloudflare-pages-admission.ts";
import type { CloudflarePagesControlPlaneSnapshot } from "./cloudflare-pages-control-plane-contract.ts";
import { CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA } from "./cloudflare-pages-control-plane-contract.ts";
import { createCloudflarePagesControlPlaneSnapshot } from "./cloudflare-pages-control-plane-snapshot.ts";
import {
  resolveCloudflarePagesArtifactForSubmission,
  vaultRuntimeForCloudflareDeployment,
} from "./cloudflare-pages-control-plane-backend-support.ts";
import type { ResolvedCloudflarePagesServiceSubmitRequest } from "./cloudflare-pages-control-plane-service-submit.ts";
import {
  cloudflarePagesPreviewIdentitySelector,
  deriveCloudflarePagesPreviewTarget,
} from "./cloudflare-pages-preview.ts";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import type { DeploymentLaneGovernanceResolver } from "./deployment-lane-governance-resolution.ts";
import { targetTransitionSnapshot } from "./cloudflare-pages-control-plane-backend-transition-snapshot.ts";
// prettier-ignore
export type CloudflarePagesBackendSnapshot = CloudflarePagesControlPlaneSnapshot | Record<string, unknown>;
async function previewSnapshot(
  resolved: Extract<ResolvedCloudflarePagesServiceSubmitRequest, { kind: "preview" }>,
  workspaceRoot: string,
  recordsRoot: string,
  governanceResolver?: DeploymentLaneGovernanceResolver,
): Promise<CloudflarePagesControlPlaneSnapshot> {
  const sourceRunId = String(resolved.request.sourceRunId || "").trim();
  const effectiveRunTarget = deriveCloudflarePagesPreviewTarget(
    resolved.request.deployment,
    sourceRunId,
  );
  const admittedContext = await resolveSourceRunCloudflarePagesAdmittedContext({
    workspaceRoot,
    deployment: resolved.request.deployment,
    artifactIdentity: resolved.selection.artifact.identity,
    sourceRecord: resolved.selection.sourceRecord,
    deferSecretReferenceResolution: true,
  });
  admittedContext.policyEvaluation = await evaluateDeploymentAdmission({
    workspaceRoot,
    recordsRoot,
    deployment: resolved.request.deployment,
    operationKind: "preview",
    admittedContext,
    sourceRecord: resolved.selection.sourceRecord,
    artifactLineageId: resolved.selection.artifactLineageId,
    evidence: resolved.request.admissionEvidence,
    governanceResolver,
  });
  return {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
    submissionId: resolved.request.submissionId,
    submittedAt: resolved.request.submittedAt,
    operationKind: "deploy",
    deploymentId: resolved.request.deployment.deploymentId,
    deploymentLabel: resolved.request.deployment.label,
    providerTargetIdentity: effectiveRunTarget.providerTargetIdentity,
    lockScope: resolved.request.deployment.providerTarget.providerTargetIdentity,
    deployment: resolved.request.deployment,
    admittedContext,
    ...vaultRuntimeForCloudflareDeployment(resolved.request.deployment),
    paths: { workspaceRoot, recordsRoot },
    action: {
      kind: "deploy",
      publishBehavior: "deploy",
      publishMode: "preview",
      effectiveRunTarget,
      previewIdentitySelector: cloudflarePagesPreviewIdentitySelector(sourceRunId),
      publishInput: { kind: "exact-artifact", artifact: resolved.selection.artifact },
      parentRunId: resolved.selection.parentRunId,
      releaseLineageId: resolved.selection.releaseLineageId,
      artifactLineageId: resolved.selection.artifactLineageId,
      sourceRecordPath: resolved.selection.sourceRecordPath,
      sourceReplaySnapshotPath: resolved.selection.sourceReplaySnapshotPath,
    },
    ...(resolved.request.smokeConnectOverride
      ? { smokeConnectOverride: resolved.request.smokeConnectOverride }
      : {}),
  };
}
async function rollbackSnapshot(
  resolved: Extract<ResolvedCloudflarePagesServiceSubmitRequest, { kind: "rollback" }>,
  workspaceRoot: string,
  recordsRoot: string,
  governanceResolver?: DeploymentLaneGovernanceResolver,
): Promise<CloudflarePagesControlPlaneSnapshot> {
  const admittedContext = await resolveSourceRunCloudflarePagesAdmittedContext({
    workspaceRoot,
    deployment: resolved.request.deployment,
    artifactIdentity: resolved.selection.artifact.identity,
    sourceRecord: resolved.selection.sourceRecord,
    deferSecretReferenceResolution: true,
  });
  admittedContext.policyEvaluation = await evaluateDeploymentAdmission({
    workspaceRoot,
    recordsRoot,
    deployment: resolved.request.deployment,
    operationKind: "rollback",
    admittedContext,
    sourceRecord: resolved.selection.sourceRecord,
    artifactLineageId: resolved.selection.artifactLineageId,
    evidence: resolved.request.admissionEvidence,
    governanceResolver,
  });
  return {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
    submissionId: resolved.request.submissionId,
    submittedAt: resolved.request.submittedAt,
    operationKind: "rollback",
    deploymentId: resolved.request.deployment.deploymentId,
    deploymentLabel: resolved.request.deployment.label,
    providerTargetIdentity: resolved.request.deployment.providerTarget.providerTargetIdentity,
    lockScope: resolved.request.deployment.providerTarget.providerTargetIdentity,
    deployment: resolved.request.deployment,
    admittedContext,
    ...vaultRuntimeForCloudflareDeployment(resolved.request.deployment),
    paths: { workspaceRoot, recordsRoot },
    action: {
      kind: "deploy",
      publishBehavior: "publish-only",
      publishInput: { kind: "exact-artifact", artifact: resolved.selection.artifact },
      parentRunId: resolved.selection.parentRunId,
      releaseLineageId: resolved.selection.releaseLineageId,
      artifactLineageId: resolved.selection.artifactLineageId,
      sourceRecordPath: resolved.selection.sourceRecordPath,
      sourceReplaySnapshotPath: resolved.selection.sourceReplaySnapshotPath,
    },
    ...(resolved.request.smokeConnectOverride
      ? { smokeConnectOverride: resolved.request.smokeConnectOverride }
      : {}),
  };
}
function previewCleanupSnapshot(
  resolved: Extract<ResolvedCloudflarePagesServiceSubmitRequest, { kind: "preview_cleanup" }>,
  workspaceRoot: string,
  recordsRoot: string,
) {
  const sourceRunId = String(resolved.request.sourceRunId || "").trim();
  const effectiveRunTarget = deriveCloudflarePagesPreviewTarget(
    resolved.request.deployment,
    sourceRunId,
  );
  return {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
    submissionId: resolved.request.submissionId,
    submittedAt: resolved.request.submittedAt,
    operationKind: "preview_cleanup",
    deploymentId: resolved.request.deployment.deploymentId,
    deploymentLabel: resolved.request.deployment.label,
    providerTargetIdentity: effectiveRunTarget.providerTargetIdentity,
    lockScope: resolved.request.deployment.providerTarget.providerTargetIdentity,
    deployment: resolved.request.deployment,
    admittedContext: resolved.selection.sourceRecord.admittedContext,
    ...vaultRuntimeForCloudflareDeployment(resolved.request.deployment),
    paths: { workspaceRoot, recordsRoot },
    action: {
      kind: "preview_cleanup",
      publishMode: "preview",
      effectiveRunTarget,
      previewIdentitySelector: cloudflarePagesPreviewIdentitySelector(sourceRunId),
      cleanupReason: resolved.request.cleanupReason,
      artifactIdentity: resolved.selection.artifact.identity,
      artifactLineageId: resolved.selection.artifactLineageId,
      ...(resolved.latestPreview?.providerReleaseId
        ? { providerReleaseId: resolved.latestPreview.providerReleaseId }
        : {}),
      ...(resolved.latestPreview?.deployRunId
        ? { parentRunId: resolved.latestPreview.deployRunId }
        : {}),
      ...(resolved.latestPreview?.releaseLineageId
        ? { releaseLineageId: resolved.latestPreview.releaseLineageId }
        : {}),
      sourceRecordPath: resolved.selection.sourceRecordPath,
      sourceReplaySnapshotPath: resolved.selection.sourceReplaySnapshotPath,
    },
  };
}
export async function buildCloudflarePagesBackendSnapshot(
  resolved: ResolvedCloudflarePagesServiceSubmitRequest,
  opts: {
    workspaceRoot: string;
    recordsRoot: string;
    governanceResolver?: DeploymentLaneGovernanceResolver;
  },
): Promise<CloudflarePagesBackendSnapshot> {
  if (resolved.kind === "deploy") {
    return await createCloudflarePagesControlPlaneSnapshot(
      {
        workspaceRoot: opts.workspaceRoot,
        deployment: resolved.request.deployment,
        recordsRoot: opts.recordsRoot,
        ...(resolved.request.deployBatchId
          ? { deployBatchId: resolved.request.deployBatchId }
          : {}),
        artifact: await resolveCloudflarePagesArtifactForSubmission(resolved, opts),
        expectedSourceRevision: resolved.request.expectedSourceRevision,
        ...(resolved.request.smokeConnectOverride
          ? { smokeConnectOverride: resolved.request.smokeConnectOverride }
          : {}),
        deferSecretReferenceResolution: true,
      },
      resolved.request.submissionId,
    );
  }
  if (resolved.kind === "promotion") {
    return await createCloudflarePagesControlPlaneSnapshot(
      {
        workspaceRoot: opts.workspaceRoot,
        deployment: resolved.request.deployment,
        recordsRoot: opts.recordsRoot,
        ...(resolved.request.deployBatchId
          ? { deployBatchId: resolved.request.deployBatchId }
          : {}),
        ...(resolved.artifactInput
          ? { artifact: await resolveCloudflarePagesArtifactForSubmission(resolved, opts) }
          : {}),
        ...(resolved.artifact ? { artifact: resolved.artifact } : {}),
        operationKind: resolved.operationKind,
        publishBehavior: resolved.request.publishBehavior || "deploy",
        parentRunId: resolved.parentRunId,
        releaseLineageId: resolved.releaseLineageId,
        artifactLineageId: resolved.artifactLineageId,
        source: resolved.source,
        ...(resolved.request.smokeConnectOverride
          ? { smokeConnectOverride: resolved.request.smokeConnectOverride }
          : {}),
        deferSecretReferenceResolution: true,
      },
      resolved.request.submissionId,
    );
  }
  if (resolved.kind === "preview")
    return await previewSnapshot(
      resolved,
      opts.workspaceRoot,
      opts.recordsRoot,
      opts.governanceResolver,
    );
  if (resolved.kind === "rollback")
    return await rollbackSnapshot(
      resolved,
      opts.workspaceRoot,
      opts.recordsRoot,
      opts.governanceResolver,
    );
  return resolved.kind === "preview_cleanup"
    ? previewCleanupSnapshot(resolved, opts.workspaceRoot, opts.recordsRoot)
    : targetTransitionSnapshot(resolved);
}
