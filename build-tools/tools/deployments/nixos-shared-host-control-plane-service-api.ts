#!/usr/bin/env zx-wrapper
import {
  authorizeControlPlaneRunAction,
  authorizeControlPlaneSubmit,
} from "./deployment-control-plane-authz.ts";
import { fingerprintControlPlanePayload } from "./deployment-control-plane-idempotency.ts";
import { submitDeploymentControlPlaneRunAction } from "./deployment-control-plane-run-action.ts";
import {
  statusFromSubmission,
  submitResponseFromSubmission,
} from "./deployment-control-plane-status.ts";
import type {
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneRunActionRequest,
} from "./deployment-control-plane-contract.ts";
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import {
  enqueueBackendSubmission,
  readBackendDeployRecordByDeployRunId,
  readBackendDeployRecordBySubmissionId,
  readBackendSubmissionByDeployRunId,
  readBackendSubmissionBySubmissionId,
  readBackendSubmissionEnvelopeByDeployRunId,
  readBackendSubmissionEnvelopeBySubmissionId,
  resolveBackendIdempotency,
  syncBackendRunAction,
  syncBackendSnapshot,
  syncBackendSubmission,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend.ts";
import {
  materializeBackendControlPlaneFiles,
  persistMaterializedSubmission,
  removeMirrorFile,
} from "./nixos-shared-host-control-plane-backend-materialize.ts";
import {
  NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  type NixosSharedHostControlPlaneSubmitRequest,
} from "./nixos-shared-host-control-plane-api-contract.ts";
import type {
  NixosSharedHostControlPlanePaths,
  NixosSharedHostControlPlaneSnapshot,
} from "./nixos-shared-host-control-plane-contract.ts";
import { prepareNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane-prepare.ts";
import {
  readControlPlaneJson,
  runActionRequestPathFor,
} from "./nixos-shared-host-control-plane-store.ts";

export type ServiceRunActionRequest = DeploymentControlPlaneRunActionRequest & {
  deployRunId?: string;
  requestedBy?: DeploymentPrincipal;
  authorization?: DeploymentControlPlaneAuthorization;
};

async function syncAndRemoveMirrors(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionPath: string;
  executionSnapshotPath: string;
}) {
  await syncBackendSnapshot(opts.backend, opts.executionSnapshotPath);
  await syncBackendSubmission(opts.backend, opts.submissionPath);
  await removeMirrorFile(opts.submissionPath);
  await removeMirrorFile(opts.executionSnapshotPath);
}

export async function handleControlPlaneSubmit(
  request: NixosSharedHostControlPlaneSubmitRequest,
  opts: {
    workspaceRoot: string;
    paths: NixosSharedHostControlPlanePaths;
    backend: NixosSharedHostControlPlaneBackendTarget;
  },
) {
  if (request.schemaVersion !== NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA) {
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
  const authorization = request.authorization
    ? authorizeControlPlaneSubmit({
        deployment: request.deployment,
        operationKind: request.operationKind,
        authorization: request.authorization,
      })
    : undefined;
  try {
    const prepared = await prepareNixosSharedHostControlPlaneRun({
      workspaceRoot: opts.workspaceRoot,
      operationKind: request.operationKind,
      deployment: request.deployment,
      paths: opts.paths,
      backendDatabaseUrl: opts.backend.databaseUrl,
      submissionId: request.submissionId,
      dedupe: {
        mode: dedupe.mode,
        requestFingerprint,
        ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      },
      requestedBy: request.requestedBy || request.admissionEvidence?.requestedBy,
      ...(authorization ? { authorization } : {}),
      ...(request.deployBatchId ? { deployBatchId: request.deployBatchId } : {}),
      ...(request.artifactDir ? { artifactDir: request.artifactDir } : {}),
      ...(request.artifactDirsByComponentId
        ? { artifactDirsByComponentId: request.artifactDirsByComponentId }
        : {}),
      ...(request.artifact ? { artifact: request.artifact } : {}),
      ...(request.componentArtifacts ? { componentArtifacts: request.componentArtifacts } : {}),
      ...(request.publishBehavior ? { publishBehavior: request.publishBehavior } : {}),
      ...(request.parentRunId ? { parentRunId: request.parentRunId } : {}),
      ...(request.releaseLineageId ? { releaseLineageId: request.releaseLineageId } : {}),
      ...(request.artifactLineageId ? { artifactLineageId: request.artifactLineageId } : {}),
      ...(request.smokeConnectOverride
        ? { smokeConnectOverride: request.smokeConnectOverride }
        : {}),
      ...(request.source ? { source: request.source } : {}),
      ...(request.admissionEvidence ? { admissionEvidence: request.admissionEvidence } : {}),
    });
    await syncAndRemoveMirrors({
      backend: opts.backend,
      submissionPath: prepared.submissionPath,
      executionSnapshotPath: prepared.executionSnapshotPath,
    });
    await enqueueBackendSubmission(
      opts.backend,
      prepared.submission.submissionId,
      prepared.submission.submittedAt,
    );
    return submitResponseFromSubmission(prepared.submission as any);
  } catch (error) {
    if (!(error as any)?.submissionPath || !(error as any)?.executionSnapshotPath) throw error;
    await syncAndRemoveMirrors({
      backend: opts.backend,
      submissionPath: (error as any).submissionPath,
      executionSnapshotPath: (error as any).executionSnapshotPath,
    });
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
    await materialized.cleanup();
  }
}

export async function readControlPlaneStatus(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: {
    submissionId?: string;
    deployRunId?: string;
  },
) {
  const submission = opts.submissionId
    ? await readBackendSubmissionBySubmissionId(backend, opts.submissionId)
    : opts.deployRunId
      ? await readBackendSubmissionByDeployRunId(backend, opts.deployRunId)
      : null;
  return submission ? statusFromSubmission(submission as any) : null;
}

export async function readControlPlaneRecord(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: {
    submissionId?: string;
    deployRunId?: string;
  },
) {
  return opts.submissionId
    ? await readBackendDeployRecordBySubmissionId(backend, opts.submissionId)
    : opts.deployRunId
      ? await readBackendDeployRecordByDeployRunId(backend, opts.deployRunId)
      : null;
}
