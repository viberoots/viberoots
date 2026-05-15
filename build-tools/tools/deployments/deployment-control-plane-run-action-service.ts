#!/usr/bin/env zx-wrapper
import { submitDeploymentControlPlaneRunAction } from "./deployment-control-plane-run-action";
import { writeBackendControlPlaneRunActionFailureAuditEvent } from "./deployment-control-plane-audit";
import { resolveRunActionAuthorizationBoundary } from "./deployment-service-authorization-boundary";
import {
  enqueueBackendSubmission,
  readBackendSubmissionEnvelopeByDeployRunId,
  readBackendSubmissionEnvelopeBySubmissionId,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import {
  materializeBackendControlPlaneFiles,
  persistMaterializedSnapshot,
  persistMaterializedSubmission,
} from "./nixos-shared-host-control-plane-backend-materialize";
import type { NixosSharedHostControlPlaneSnapshot } from "./nixos-shared-host-control-plane-contract";
import { readControlPlaneJson } from "./nixos-shared-host-control-plane-store";
import { queryBackend } from "./nixos-shared-host-control-plane-backend-db";
import type { ServiceRunActionRequest } from "./nixos-shared-host-control-plane-service-api";

function failureSummary(error: unknown) {
  const err = error as { code?: unknown; message?: unknown };
  return [err?.code, err?.message].filter(Boolean).join(": ") || "run action failed";
}

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
  let boundary: Awaited<ReturnType<typeof resolveRunActionAuthorizationBoundary>> | undefined;
  try {
    boundary = await resolveRunActionAuthorizationBoundary({
      recordsRoot: opts.backend.recordsRoot,
      deployment: snapshot.deployment,
      action: request.action,
      authSessionId: request.authSessionId,
      request,
      authorization: request.authorization,
      requestedBy: request.requestedBy,
    });
    const response = await submitDeploymentControlPlaneRunAction({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.backend.recordsRoot,
      backend: opts.backend,
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
    return { ...response, ...(boundary.decision ? { authorization: boundary.decision } : {}) };
  } catch (error) {
    await writeBackendControlPlaneRunActionFailureAuditEvent({
      client: {
        query: async <T extends Record<string, unknown> = Record<string, unknown>>(
          sql: string,
          params?: readonly unknown[],
        ) => await queryBackend<T>(opts.backend, sql, params),
      },
      requestId: request.actionId,
      actor:
        boundary?.requestedBy?.principalId ||
        request.requestedBy?.principalId ||
        request.authorization?.requestedBy?.principalId,
      operation: request.action,
      idempotencyKey: request.idempotencyKey || request.actionId,
      deploymentId: snapshot.deployment.deploymentId,
      failureSummary: failureSummary(error),
      occurredAt: request.submittedAt,
    });
    throw error;
  } finally {
    await persistMaterializedSnapshot({
      backend: opts.backend,
      executionSnapshotPath: materialized.executionSnapshotPath,
      executionSnapshotRef: materialized.executionSnapshotRef,
    });
    await materialized.cleanup();
  }
}
