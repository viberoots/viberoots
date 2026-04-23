#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import type {
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneRunAction,
} from "./deployment-control-plane-contract.ts";
import { authorizeControlPlaneRunAction } from "./deployment-control-plane-authz.ts";
import { DeploymentUnauthorizedError } from "./deployment-control-plane-errors.ts";
import {
  consumeDeploymentAuthSessionAuthorization,
  readDeploymentAuthSessionAuthorization,
} from "./deployment-auth-session-service.ts";

type ClientAuthFields = {
  requestedBy?: unknown;
  authorization?: unknown;
  admissionEvidence?: DeploymentAdmissionEvidence;
};

function unauthorized(message: string): Error {
  return Object.assign(new DeploymentUnauthorizedError(message), { statusCode: 403 });
}

export function requiresServerDerivedAuthorization(deployment: DeploymentTarget): boolean {
  return deployment.protectionClass !== "local_only" && !!deployment.vaultRuntime?.oidcIssuer;
}

function assertNoClientIdentityFields(request: ClientAuthFields) {
  if (request.requestedBy || request.authorization || request.admissionEvidence?.requestedBy) {
    throw unauthorized(
      "auth-required protected/shared submissions must not supply requestedBy or authorization grants",
    );
  }
}

function evidenceWithPrincipal(
  evidence: DeploymentAdmissionEvidence | undefined,
  authorization: DeploymentControlPlaneAuthorization,
): DeploymentAdmissionEvidence {
  return { ...(evidence || {}), requestedBy: authorization.requestedBy };
}

export async function resolveSubmitAuthorizationBoundary(opts: {
  recordsRoot: string;
  deployment: DeploymentTarget;
  operationKind: string;
  authSessionId?: string;
  request: ClientAuthFields;
  authorization?: DeploymentControlPlaneAuthorization;
  requestedBy?: DeploymentControlPlaneAuthorization["requestedBy"];
  admissionEvidence?: DeploymentAdmissionEvidence;
  consumeAuthSession?: boolean;
}) {
  if (!requiresServerDerivedAuthorization(opts.deployment)) {
    return {
      authorization: opts.authorization,
      requestedBy: opts.requestedBy || opts.admissionEvidence?.requestedBy,
      admissionEvidence: opts.admissionEvidence,
    };
  }
  assertNoClientIdentityFields(opts.request);
  if (!opts.authSessionId) {
    throw unauthorized("auth-required protected/shared submissions require authSessionId");
  }
  const resolveAuthorization =
    opts.consumeAuthSession === false
      ? readDeploymentAuthSessionAuthorization
      : consumeDeploymentAuthSessionAuthorization;
  const authorization = await resolveAuthorization({
    recordsRoot: opts.recordsRoot,
    sessionId: opts.authSessionId,
    deploymentId: opts.deployment.deploymentId,
    operationKind: opts.operationKind,
  });
  return {
    authorization,
    requestedBy: authorization.requestedBy,
    admissionEvidence: evidenceWithPrincipal(opts.admissionEvidence, authorization),
  };
}

export async function resolveRunActionAuthorizationBoundary(opts: {
  recordsRoot: string;
  deployment: DeploymentTarget;
  action: DeploymentControlPlaneRunAction;
  authSessionId?: string;
  request: ClientAuthFields;
  authorization?: DeploymentControlPlaneAuthorization;
  requestedBy?: DeploymentControlPlaneAuthorization["requestedBy"];
}): Promise<{
  decision?: DeploymentControlPlaneAuthorizationDecision;
  requestedBy?: DeploymentControlPlaneAuthorization["requestedBy"];
}> {
  if (!requiresServerDerivedAuthorization(opts.deployment)) {
    const authorization = opts.authorization
      ? authorizeControlPlaneRunAction({
          deployment: opts.deployment,
          action: opts.action,
          authorization: opts.authorization,
        })
      : undefined;
    return {
      decision: authorization,
      requestedBy: opts.requestedBy || opts.authorization?.requestedBy,
    };
  }
  assertNoClientIdentityFields(opts.request);
  if (!opts.authSessionId) {
    throw unauthorized("auth-required run actions require authSessionId");
  }
  const authorization = await consumeDeploymentAuthSessionAuthorization({
    recordsRoot: opts.recordsRoot,
    sessionId: opts.authSessionId,
    deploymentId: opts.deployment.deploymentId,
    operationKind: opts.action,
  });
  return {
    decision: authorizeControlPlaneRunAction({
      deployment: opts.deployment,
      action: opts.action,
      authorization,
    }),
    requestedBy: authorization.requestedBy,
  };
}
