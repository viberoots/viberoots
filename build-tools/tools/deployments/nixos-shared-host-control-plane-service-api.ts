#!/usr/bin/env zx-wrapper
import { authorizeControlPlaneSubmit } from "./deployment-control-plane-authz";
import { resolveSubmitAuthorizationBoundary } from "./deployment-service-authorization-boundary";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  type CloudflarePagesControlPlaneSubmitRequest,
} from "./cloudflare-pages-control-plane-api-contract";
import { prepareBackendCloudflarePagesControlPlaneRun } from "./cloudflare-pages-control-plane-backend-prepare";
import { resolveCloudflarePagesServiceSubmitRequest } from "./cloudflare-pages-control-plane-service-submit";
import { assertNoProtectedSharedClientIdentityFields } from "./deployment-service-client-contract";
import { handleControlPlaneRunActionService } from "./deployment-control-plane-run-action-service";
import {
  isDeploymentProviderServiceSubmitRequest,
  queueDeploymentProviderControlPlaneSubmission,
  type DeploymentProviderServiceSubmitRequest,
} from "./deployment-provider-control-plane-submit";
import { submitResponseFromSubmission } from "./deployment-control-plane-status";
import type {
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneRunActionRequest,
} from "./deployment-control-plane-contract";
import type { DeploymentPrincipal } from "./deployment-admission-evidence";
import {
  enqueueBackendSubmission,
  resolveBackendIdempotency,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import {
  NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  type NixosSharedHostControlPlaneSubmitRequest,
} from "./nixos-shared-host-control-plane-api-contract";
import type { NixosSharedHostControlPlanePaths } from "./nixos-shared-host-control-plane-contract";
import { prepareBackendNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane-backend-prepare";
import { reusedBackendSubmitResponse } from "./nixos-shared-host-control-plane-service-idempotency";
import { resolveServiceSubmitRequest } from "./nixos-shared-host-control-plane-service-submit";
import { handleProtectedChallengedNixosServiceSubmit } from "./nixos-shared-host-control-plane-service-protected-submit";
import { resolveNixosSharedHostSubmitContext } from "./nixos-shared-host-control-plane-submit-context";
// prettier-ignore
export { readControlPlaneRecord, readControlPlaneStatus } from "./nixos-shared-host-control-plane-service-read";

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
  if (isDeploymentProviderServiceSubmitRequest(request))
    return await queueDeploymentProviderControlPlaneSubmission(request, opts);
  const resolvedRequest =
    request.schemaVersion === NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA
      ? await resolveServiceSubmitRequest(request, opts)
      : await resolveCloudflarePagesServiceSubmitRequest(request, {
          workspaceRoot: opts.workspaceRoot,
          recordsRoot: opts.paths.recordsRoot,
          backendDatabaseUrl: opts.backend.databaseUrl,
        });
  const { requestFingerprint, idempotencyKey, governanceResolver, serviceInstance } =
    await resolveNixosSharedHostSubmitContext({
      request,
      resolvedRequest,
      workspaceRoot: opts.workspaceRoot,
      localFixture: opts.localFixture,
      env: opts.env,
    });
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
      governanceResolver,
      ...(serviceInstance ? { serviceInstance } : {}),
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
  if (dedupe.mode === "reused")
    return await reusedBackendSubmitResponse(opts.backend, dedupe.targetId);
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
            ...(boundary.authorization ? { authorizationSnapshot: boundary.authorization } : {}),
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
            ...(resolvedRequest.expectedSourceRevision
              ? { expectedSourceRevision: resolvedRequest.expectedSourceRevision }
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
            governanceResolver,
            ...(serviceInstance ? { serviceInstance } : {}),
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
            ...(boundary.authorization ? { authorizationSnapshot: boundary.authorization } : {}),
            ...(serviceInstance ? { serviceInstance } : {}),
            governanceResolver,
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

// prettier-ignore
export async function handleControlPlaneRunAction(
  request: ServiceRunActionRequest,
  opts: { backend: NixosSharedHostControlPlaneBackendTarget; workspaceRoot: string }) {
  return await handleControlPlaneRunActionService(request, opts);
}
