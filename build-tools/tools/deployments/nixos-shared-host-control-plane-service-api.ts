#!/usr/bin/env zx-wrapper
import {
  authorizeControlPlaneRunAction,
  authorizeControlPlaneSubmit,
} from "./deployment-control-plane-authz.ts";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  type CloudflarePagesControlPlaneSubmitRequest,
} from "./cloudflare-pages-control-plane-api-contract.ts";
import { prepareBackendCloudflarePagesControlPlaneRun } from "./cloudflare-pages-control-plane-backend-prepare.ts";
import { resolveCloudflarePagesServiceSubmitRequest } from "./cloudflare-pages-control-plane-service-submit.ts";
import { fingerprintControlPlanePayload } from "./deployment-control-plane-idempotency.ts";
import { submitDeploymentControlPlaneRunAction } from "./deployment-control-plane-run-action.ts";
import { submitResponseFromSubmission } from "./deployment-control-plane-status.ts";
import type {
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneRunActionRequest,
} from "./deployment-control-plane-contract.ts";
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import {
  enqueueBackendSubmission,
  readBackendSubmissionBySubmissionId,
  readBackendSubmissionEnvelopeByDeployRunId,
  readBackendSubmissionEnvelopeBySubmissionId,
  resolveBackendIdempotency,
  syncBackendRunAction,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend.ts";
import {
  materializeBackendControlPlaneFiles,
  persistMaterializedSnapshot,
  persistMaterializedSubmission,
} from "./nixos-shared-host-control-plane-backend-materialize.ts";
import {
  NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  type NixosSharedHostControlPlaneSubmitRequest,
} from "./nixos-shared-host-control-plane-api-contract.ts";
import type {
  NixosSharedHostControlPlanePaths,
  NixosSharedHostControlPlaneSnapshot,
} from "./nixos-shared-host-control-plane-contract.ts";
import { prepareBackendNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane-backend-prepare.ts";
import {
  readControlPlaneJson,
  runActionRequestPathFor,
} from "./nixos-shared-host-control-plane-store.ts";
import { resolveServiceSubmitRequest } from "./nixos-shared-host-control-plane-service-submit.ts";
export {
  readControlPlaneRecord,
  readControlPlaneStatus,
} from "./nixos-shared-host-control-plane-service-read.ts";

// prettier-ignore
export type ServiceRunActionRequest = DeploymentControlPlaneRunActionRequest & { deployRunId?: string; requestedBy?: DeploymentPrincipal; authorization?: DeploymentControlPlaneAuthorization; };

type ServiceSubmitRequest =
  | NixosSharedHostControlPlaneSubmitRequest
  | CloudflarePagesControlPlaneSubmitRequest;

export async function handleControlPlaneSubmit(
  request: ServiceSubmitRequest,
  opts: {
    workspaceRoot: string;
    paths: NixosSharedHostControlPlanePaths;
    backend: NixosSharedHostControlPlaneBackendTarget;
  },
) {
  if (
    request.schemaVersion !== NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA &&
    request.schemaVersion !== CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA
  ) {
    throw new Error(`unsupported schema version: ${request.schemaVersion}`);
  }
  const requestFingerprint = fingerprintControlPlanePayload({
    ...request,
    submittedAt: request.submittedAt,
  });
  const idempotencyKey = request.idempotencyKey || request.submissionId;
  const dedupe = await resolveBackendIdempotency({
    backend: opts.backend,
    kind: "submit",
    key: idempotencyKey,
    requestFingerprint,
    targetId: request.submissionId,
  });
  if (dedupe.mode === "reused") {
    const existing = await readBackendSubmissionBySubmissionId(opts.backend, dedupe.targetId);
    if (!existing) {
      throw new Error(`idempotent submission missing backend state: ${dedupe.targetId}`);
    }
    return submitResponseFromSubmission(existing as any);
  }
  const resolvedRequest =
    request.schemaVersion === NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA
      ? await resolveServiceSubmitRequest(request, opts)
      : await resolveCloudflarePagesServiceSubmitRequest(request, {
          workspaceRoot: opts.workspaceRoot,
          recordsRoot: opts.paths.recordsRoot,
          backendDatabaseUrl: opts.backend.databaseUrl,
        });
  const authorization = resolvedRequest.authorization
    ? authorizeControlPlaneSubmit({
        deployment: resolvedRequest.deployment,
        operationKind: resolvedRequest.operationKind,
        authorization: resolvedRequest.authorization,
      })
    : undefined;
  try {
    const prepared =
      request.schemaVersion === NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA
        ? await prepareBackendNixosSharedHostControlPlaneRun({
            workspaceRoot: opts.workspaceRoot,
            operationKind: resolvedRequest.operationKind,
            deployment: resolvedRequest.deployment,
            paths: opts.paths,
            backend: opts.backend,
            submissionId: resolvedRequest.submissionId,
            dedupe: {
              mode: dedupe.mode,
              requestFingerprint,
              ...(resolvedRequest.idempotencyKey
                ? { idempotencyKey: resolvedRequest.idempotencyKey }
                : {}),
            },
            requestedBy:
              resolvedRequest.requestedBy || resolvedRequest.admissionEvidence?.requestedBy,
            ...(authorization ? { authorization } : {}),
            ...(resolvedRequest.deployBatchId
              ? { deployBatchId: resolvedRequest.deployBatchId }
              : {}),
            ...(resolvedRequest.artifactDir ? { artifactDir: resolvedRequest.artifactDir } : {}),
            ...(resolvedRequest.artifactDirsByComponentId
              ? { artifactDirsByComponentId: resolvedRequest.artifactDirsByComponentId }
              : {}),
            ...(resolvedRequest.artifact ? { artifact: resolvedRequest.artifact } : {}),
            ...(resolvedRequest.componentArtifacts
              ? { componentArtifacts: resolvedRequest.componentArtifacts }
              : {}),
            ...(resolvedRequest.publishBehavior
              ? { publishBehavior: resolvedRequest.publishBehavior }
              : {}),
            ...(resolvedRequest.parentRunId ? { parentRunId: resolvedRequest.parentRunId } : {}),
            ...(resolvedRequest.releaseLineageId
              ? { releaseLineageId: resolvedRequest.releaseLineageId }
              : {}),
            ...(resolvedRequest.artifactLineageId
              ? { artifactLineageId: resolvedRequest.artifactLineageId }
              : {}),
            ...(resolvedRequest.smokeConnectOverride
              ? { smokeConnectOverride: resolvedRequest.smokeConnectOverride }
              : {}),
            ...(resolvedRequest.source ? { source: resolvedRequest.source } : {}),
            ...(resolvedRequest.admissionEvidence
              ? { admissionEvidence: resolvedRequest.admissionEvidence }
              : {}),
          })
        : await prepareBackendCloudflarePagesControlPlaneRun({
            workspaceRoot: opts.workspaceRoot,
            recordsRoot: opts.paths.recordsRoot,
            backend: opts.backend,
            request,
            resolved: resolvedRequest,
            dedupe: {
              mode: dedupe.mode,
              requestFingerprint,
              ...(resolvedRequest.idempotencyKey
                ? { idempotencyKey: resolvedRequest.idempotencyKey }
                : {}),
            },
            ...(authorization ? { authorization } : {}),
          });
    await enqueueBackendSubmission(
      opts.backend,
      prepared.submission.submissionId,
      prepared.submission.submittedAt,
    );
    return submitResponseFromSubmission(prepared.submission as any);
  } catch (error) {
    if (!(error as any)?.submission) throw error;
    return submitResponseFromSubmission((error as any).submission);
  }
}

export async function handleControlPlaneRunAction(
  request: ServiceRunActionRequest,
  opts: { backend: NixosSharedHostControlPlaneBackendTarget; workspaceRoot: string },
) {
  const envelope = request.submissionId
    ? await readBackendSubmissionEnvelopeBySubmissionId(opts.backend, request.submissionId)
    : request.deployRunId
      ? await readBackendSubmissionEnvelopeByDeployRunId(opts.backend, request.deployRunId)
      : null;
  if (!envelope) throw Object.assign(new Error("submission not found"), { statusCode: 404 });
  const materialized = await materializeBackendControlPlaneFiles(
    opts.backend,
    String((envelope.submission as any).submissionId),
  );
  const snapshot = await readControlPlaneJson<NixosSharedHostControlPlaneSnapshot>(
    materialized.executionSnapshotPath,
  );
  const authorization = request.authorization
    ? authorizeControlPlaneRunAction({
        deployment: snapshot.deployment,
        action: request.action,
        authorization: request.authorization,
      })
    : undefined;
  try {
    const response = await submitDeploymentControlPlaneRunAction({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.backend.recordsRoot,
      backendDatabaseUrl: opts.backend.databaseUrl,
      submissionPath: materialized.submissionPath,
      action: request.action,
      idempotencyKey: request.idempotencyKey || request.actionId,
      ...(request.requestedBy || request.authorization?.requestedBy
        ? { requestedBy: request.requestedBy || request.authorization?.requestedBy }
        : {}),
      ...(request.approval ? { approval: request.approval } : {}),
    });
    await persistMaterializedSubmission({
      backend: opts.backend,
      submissionPath: materialized.submissionPath,
      submissionRef: materialized.submissionRef,
      executionSnapshotRef: materialized.executionSnapshotRef,
    });
    if (
      request.action === "approve" &&
      ["queued", "waiting_for_lock"].includes(response.lifecycleState)
    ) {
      await enqueueBackendSubmission(opts.backend, response.submissionId, response.submittedAt);
    }
    await syncBackendRunAction(
      opts.backend,
      runActionRequestPathFor(opts.backend.recordsRoot, response.actionId),
    );
    return {
      ...response,
      ...(authorization ? { authorization } : {}),
    };
  } finally {
    await persistMaterializedSnapshot({
      backend: opts.backend,
      executionSnapshotPath: materialized.executionSnapshotPath,
      executionSnapshotRef: materialized.executionSnapshotRef,
    });
    await materialized.cleanup();
  }
}
