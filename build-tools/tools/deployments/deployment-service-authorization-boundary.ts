#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import type {
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneRunAction,
} from "./deployment-control-plane-contract";
import {
  authorizeControlPlaneAdmissionReport,
  authorizeControlPlaneRunAction,
} from "./deployment-control-plane-authz";
import { DeploymentUnauthorizedError } from "./deployment-control-plane-errors";
import {
  consumeDeploymentAuthSessionAuthorization,
  readDeploymentAuthSessionAuthorization,
} from "./deployment-auth-session-service";
import { authenticateDeploymentAuthProviderToken } from "./deployment-auth-provider";
import type { DeploymentAuthProviderConfig } from "./deployment-auth-provider-config";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";

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

function bearerToken(authorizationHeader: string | string[] | undefined): string | undefined {
  const header = Array.isArray(authorizationHeader)
    ? authorizationHeader.find((entry) => entry.trim())
    : authorizationHeader;
  const match = /^Bearer\s+(.+)$/i.exec(String(header || "").trim());
  return match?.[1]?.trim() || undefined;
}

async function authorizationFromProviderToken(opts: {
  authProvider?: DeploymentAuthProviderConfig;
  authorizationHeader?: string | string[];
  deployment: DeploymentTarget;
}): Promise<DeploymentControlPlaneAuthorization | undefined> {
  if (!opts.authProvider || opts.authProvider.kind !== "generic-oidc-jwks") return undefined;
  const token = bearerToken(opts.authorizationHeader);
  if (!token) return undefined;
  const auth = await authenticateDeploymentAuthProviderToken({
    config: opts.authProvider,
    deployment: opts.deployment,
    token,
  });
  return auth.authorization;
}

function evidenceWithPrincipal(
  evidence: DeploymentAdmissionEvidence | undefined,
  authorization: DeploymentControlPlaneAuthorization,
): DeploymentAdmissionEvidence {
  return { ...(evidence || {}), requestedBy: authorization.requestedBy };
}

function hasAdmissionReportEvidence(evidence: DeploymentAdmissionEvidence | undefined): boolean {
  return (
    (Array.isArray(evidence?.checks) && evidence.checks.length > 0) || !!evidence?.ciSubmission
  );
}

function assertAdmissionReportEvidenceAuthorization(
  deployment: DeploymentTarget,
  authorization: DeploymentControlPlaneAuthorization | undefined,
  evidence: DeploymentAdmissionEvidence | undefined,
) {
  if (!hasAdmissionReportEvidence(evidence)) return;
  if (!authorization) return;
  authorizeControlPlaneAdmissionReport({ deployment, authorization });
}

export async function resolveSubmitAuthorizationBoundary(opts: {
  recordsRoot: string;
  backend?: NixosSharedHostControlPlaneBackendTarget;
  deployment: DeploymentTarget;
  operationKind: string;
  authSessionId?: string;
  request: ClientAuthFields;
  authorization?: DeploymentControlPlaneAuthorization;
  requestedBy?: DeploymentControlPlaneAuthorization["requestedBy"];
  admissionEvidence?: DeploymentAdmissionEvidence;
  consumeAuthSession?: boolean;
  authProvider?: DeploymentAuthProviderConfig;
  authorizationHeader?: string | string[];
}) {
  if (!requiresServerDerivedAuthorization(opts.deployment)) {
    assertAdmissionReportEvidenceAuthorization(
      opts.deployment,
      opts.authorization,
      opts.admissionEvidence,
    );
    return {
      authorization: opts.authorization,
      requestedBy: opts.requestedBy || opts.admissionEvidence?.requestedBy,
      admissionEvidence: opts.admissionEvidence,
    };
  }
  assertNoClientIdentityFields(opts.request);
  if (!opts.authSessionId) {
    const providerAuthorization = await authorizationFromProviderToken(opts);
    if (providerAuthorization) {
      assertAdmissionReportEvidenceAuthorization(
        opts.deployment,
        providerAuthorization,
        opts.admissionEvidence,
      );
      return {
        authorization: providerAuthorization,
        requestedBy: providerAuthorization.requestedBy,
        admissionEvidence: evidenceWithPrincipal(opts.admissionEvidence, providerAuthorization),
      };
    }
    throw unauthorized("auth-required protected/shared submissions require authSessionId");
  }
  const resolveAuthorization =
    opts.consumeAuthSession === false
      ? readDeploymentAuthSessionAuthorization
      : consumeDeploymentAuthSessionAuthorization;
  const authorization = await resolveAuthorization({
    recordsRoot: opts.recordsRoot,
    ...(opts.backend ? { backend: opts.backend } : {}),
    sessionId: opts.authSessionId,
    deploymentId: opts.deployment.deploymentId,
    operationKind: opts.operationKind,
  });
  assertAdmissionReportEvidenceAuthorization(
    opts.deployment,
    authorization,
    opts.admissionEvidence,
  );
  return {
    authorization,
    requestedBy: authorization.requestedBy,
    admissionEvidence: evidenceWithPrincipal(opts.admissionEvidence, authorization),
  };
}

export async function resolveRunActionAuthorizationBoundary(opts: {
  recordsRoot: string;
  backend?: NixosSharedHostControlPlaneBackendTarget;
  deployment: DeploymentTarget;
  action: DeploymentControlPlaneRunAction;
  authSessionId?: string;
  request: ClientAuthFields;
  authorization?: DeploymentControlPlaneAuthorization;
  requestedBy?: DeploymentControlPlaneAuthorization["requestedBy"];
  authProvider?: DeploymentAuthProviderConfig;
  authorizationHeader?: string | string[];
}): Promise<{
  decision?: DeploymentControlPlaneAuthorizationDecision;
  authorizationSnapshot?: DeploymentControlPlaneAuthorization;
  requestedBy?: DeploymentControlPlaneAuthorization["requestedBy"];
}> {
  if (!requiresServerDerivedAuthorization(opts.deployment)) {
    const decision = opts.authorization
      ? authorizeControlPlaneRunAction({
          deployment: opts.deployment,
          action: opts.action,
          authorization: opts.authorization,
        })
      : undefined;
    return {
      decision,
      authorizationSnapshot: opts.authorization,
      requestedBy: opts.requestedBy || opts.authorization?.requestedBy,
    };
  }
  assertNoClientIdentityFields(opts.request);
  if (!opts.authSessionId) {
    const providerAuthorization = await authorizationFromProviderToken(opts);
    if (providerAuthorization) {
      return {
        decision: authorizeControlPlaneRunAction({
          deployment: opts.deployment,
          action: opts.action,
          authorization: providerAuthorization,
        }),
        authorizationSnapshot: providerAuthorization,
        requestedBy: providerAuthorization.requestedBy,
      };
    }
    throw unauthorized("auth-required run actions require authSessionId");
  }
  const authorization = await consumeDeploymentAuthSessionAuthorization({
    recordsRoot: opts.recordsRoot,
    ...(opts.backend ? { backend: opts.backend } : {}),
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
    authorizationSnapshot: authorization,
    requestedBy: authorization.requestedBy,
  };
}
