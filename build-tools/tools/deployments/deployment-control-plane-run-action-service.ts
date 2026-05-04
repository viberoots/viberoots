#!/usr/bin/env zx-wrapper
import { submitDeploymentControlPlaneRunAction } from "./deployment-control-plane-run-action";
import { resolveRunActionAuthorizationBoundary } from "./deployment-service-authorization-boundary";
import {
  enqueueBackendSubmission,
  readBackendSubmissionEnvelopeByDeployRunId,
  readBackendSubmissionEnvelopeBySubmissionId,
  syncBackendRunAction,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import {
  materializeBackendControlPlaneFiles,
  persistMaterializedSnapshot,
  persistMaterializedSubmission,
} from "./nixos-shared-host-control-plane-backend-materialize";
import type { NixosSharedHostControlPlaneSnapshot } from "./nixos-shared-host-control-plane-contract";
import {
  readControlPlaneJson,
  runActionRequestPathFor,
} from "./nixos-shared-host-control-plane-store";
import type { ServiceRunActionRequest } from "./nixos-shared-host-control-plane-service-api";

export async function handleControlPlaneRunActionService(
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
  const boundary = await resolveRunActionAuthorizationBoundary({
    recordsRoot: opts.backend.recordsRoot,
    deployment: snapshot.deployment,
    action: request.action,
    authSessionId: request.authSessionId,
    request,
    authorization: request.authorization,
    requestedBy: request.requestedBy,
  });
  try {
    const response = await submitDeploymentControlPlaneRunAction({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.backend.recordsRoot,
      backendDatabaseUrl: opts.backend.databaseUrl,
      submissionPath: materialized.submissionPath,
      action: request.action,
      idempotencyKey: request.idempotencyKey || request.actionId,
      ...(boundary.requestedBy ? { requestedBy: boundary.requestedBy } : {}),
      ...(boundary.authorizationSnapshot
        ? { authorizationSnapshot: boundary.authorizationSnapshot }
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
    return { ...response, ...(boundary.decision ? { authorization: boundary.decision } : {}) };
  } finally {
    await persistMaterializedSnapshot({
      backend: opts.backend,
      executionSnapshotPath: materialized.executionSnapshotPath,
      executionSnapshotRef: materialized.executionSnapshotRef,
    });
    await materialized.cleanup();
  }
}
