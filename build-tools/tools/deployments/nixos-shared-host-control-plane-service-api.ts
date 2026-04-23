#!/usr/bin/env zx-wrapper
import { authorizeControlPlaneSubmit } from "./deployment-control-plane-authz.ts";
import { resolveSubmitAuthorizationBoundary } from "./deployment-service-authorization-boundary.ts";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  type CloudflarePagesControlPlaneSubmitRequest,
} from "./cloudflare-pages-control-plane-api-contract.ts";
import { prepareBackendCloudflarePagesControlPlaneRun } from "./cloudflare-pages-control-plane-backend-prepare.ts";
import { resolveCloudflarePagesServiceSubmitRequest } from "./cloudflare-pages-control-plane-service-submit.ts";
import { assertNoProtectedSharedClientIdentityFields } from "./deployment-service-client-contract.ts";
import { handleControlPlaneRunActionService } from "./deployment-control-plane-run-action-service.ts";
import {
  isDeploymentProviderServiceSubmitRequest,
  queueDeploymentProviderControlPlaneSubmission,
  type DeploymentProviderServiceSubmitRequest,
} from "./deployment-provider-control-plane-submit.ts";
import { fingerprintControlPlanePayload } from "./deployment-control-plane-idempotency.ts";
import { submitResponseFromSubmission } from "./deployment-control-plane-status.ts";
import type {
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneRunActionRequest,
} from "./deployment-control-plane-contract.ts";
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import {
  enqueueBackendSubmission,
  readBackendSubmissionBySubmissionId,
  resolveBackendIdempotency,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend.ts";
import {
  NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  type NixosSharedHostControlPlaneSubmitRequest,
} from "./nixos-shared-host-control-plane-api-contract.ts";
import type { NixosSharedHostControlPlanePaths } from "./nixos-shared-host-control-plane-contract.ts";
import { prepareBackendNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane-backend-prepare.ts";
import { resolveServiceSubmitRequest } from "./nixos-shared-host-control-plane-service-submit.ts";
import { handleProtectedChallengedNixosServiceSubmit } from "./nixos-shared-host-control-plane-service-protected-submit.ts";
export {
  readControlPlaneRecord,
  readControlPlaneStatus,
} from "./nixos-shared-host-control-plane-service-read.ts";

// prettier-ignore
export type ServiceRunActionRequest = DeploymentControlPlaneRunActionRequest & { deployRunId?: string; authSessionId?: string; requestedBy?: DeploymentPrincipal; authorization?: DeploymentControlPlaneAuthorization; };

type ServiceSubmitRequest =
  | NixosSharedHostControlPlaneSubmitRequest
  | CloudflarePagesControlPlaneSubmitRequest
  | DeploymentProviderServiceSubmitRequest;
export async function handleControlPlaneSubmit(
  request: ServiceSubmitRequest,
  opts: {
    workspaceRoot: string;
    paths: NixosSharedHostControlPlanePaths;
    backend: NixosSharedHostControlPlaneBackendTarget;
    serviceToken?: string;
    requireArtifactBinding?: boolean;
    authorizationHeader?: string | string[];
    localFixture?: boolean;
    env?: NodeJS.ProcessEnv;
  },
) {
  if (
    request.schemaVersion !== NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA &&
    request.schemaVersion !== CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA &&
    !isDeploymentProviderServiceSubmitRequest(request)
  ) {
    throw new Error(`unsupported schema version: ${request.schemaVersion}`);
  }
  assertNoProtectedSharedClientIdentityFields({
    deployment: request.deployment,
    request,
  });
  if (isDeploymentProviderServiceSubmitRequest(request)) {
    return await queueDeploymentProviderControlPlaneSubmission(request, opts);
  }
  const resolvedRequest =
    request.schemaVersion === NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA
      ? await resolveServiceSubmitRequest(request, opts)
      : await resolveCloudflarePagesServiceSubmitRequest(request, {
          workspaceRoot: opts.workspaceRoot,
          recordsRoot: opts.paths.recordsRoot,
          backendDatabaseUrl: opts.backend.databaseUrl,
        });
  const requestFingerprint = fingerprintControlPlanePayload({
    ...request,
    submittedAt: request.submittedAt,
  });
  const idempotencyKey = request.idempotencyKey || request.submissionId;
  if (
    opts.requireArtifactBinding &&
    resolvedRequest.schemaVersion === NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA &&
    (resolvedRequest.artifactDir || resolvedRequest.artifactDirsByComponentId)
  ) {
    return await handleProtectedChallengedNixosServiceSubmit({
      workspaceRoot: opts.workspaceRoot,
      paths: opts.paths,
      backend: opts.backend,
      serviceToken: opts.serviceToken,
      authorizationHeader: opts.authorizationHeader,
      localFixture: opts.localFixture,
      env: opts.env,
      request: request as NixosSharedHostControlPlaneSubmitRequest,
      resolvedRequest: resolvedRequest as NixosSharedHostControlPlaneSubmitRequest,
      requestFingerprint,
      idempotencyKey,
    });
  }
  const boundary =
    request.schemaVersion === NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA
      ? await resolveSubmitAuthorizationBoundary({
          recordsRoot: opts.paths.recordsRoot,
          deployment: resolvedRequest.deployment,
          operationKind: resolvedRequest.operationKind,
          authSessionId: request.authSessionId,
          request,
          authorization: resolvedRequest.authorization,
          requestedBy: resolvedRequest.requestedBy,
          admissionEvidence: resolvedRequest.admissionEvidence,
        })
      : {
          authorization: resolvedRequest.authorization,
          requestedBy:
            resolvedRequest.requestedBy || resolvedRequest.admissionEvidence?.requestedBy,
          admissionEvidence: resolvedRequest.admissionEvidence,
        };
  const authorization = boundary.authorization
    ? authorizeControlPlaneSubmit({
        deployment: resolvedRequest.deployment,
        operationKind: resolvedRequest.operationKind,
        authorization: boundary.authorization,
      })
    : undefined;
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
            requestedBy: boundary.requestedBy,
            ...(authorization ? { authorization } : {}),
            ...(resolvedRequest.deployBatchId
              ? { deployBatchId: resolvedRequest.deployBatchId }
              : {}),
            ...(resolvedRequest.artifactDir ? { artifactDir: resolvedRequest.artifactDir } : {}),
            ...(resolvedRequest.artifactDirsByComponentId
              ? { artifactDirsByComponentId: resolvedRequest.artifactDirsByComponentId }
              : {}),
            ...(resolvedRequest.expectedArtifactIdentity
              ? { expectedArtifactIdentity: resolvedRequest.expectedArtifactIdentity }
              : {}),
            ...(resolvedRequest.expectedComponentArtifactIdentities
              ? {
                  expectedComponentArtifactIdentities:
                    resolvedRequest.expectedComponentArtifactIdentities,
                }
              : {}),
            ...(resolvedRequest.expectedCompositeArtifactIdentity
              ? {
                  expectedCompositeArtifactIdentity:
                    resolvedRequest.expectedCompositeArtifactIdentity,
                }
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
            ...(boundary.admissionEvidence
              ? { admissionEvidence: boundary.admissionEvidence }
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
  return await handleControlPlaneRunActionService(request, opts);
}
