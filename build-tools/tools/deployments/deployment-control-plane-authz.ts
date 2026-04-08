#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import { providerTargetIdentityFor } from "./contract.ts";
import { defaultRequestedBy } from "./deployment-admission-evidence.ts";
import {
  type DeploymentControlPlaneAuthorization,
  type DeploymentControlPlaneAuthorizationDecision,
  type DeploymentControlPlaneGrant,
  type DeploymentControlPlaneRole,
  type DeploymentControlPlaneRunAction,
  type DeploymentControlPlaneScope,
} from "./deployment-control-plane-contract.ts";
import { DeploymentUnauthorizedError } from "./deployment-control-plane-errors.ts";

function defaultScopeForRole(
  deployment: DeploymentTarget,
  role: DeploymentControlPlaneRole,
): DeploymentControlPlaneScope {
  if (role === "submitter" || role === "approver") {
    return { kind: "deployment_id", value: deployment.deploymentId };
  }
  return {
    kind: "provider_target_identity",
    value: providerTargetIdentityFor(deployment),
  };
}

function scopeMatches(deployment: DeploymentTarget, scope: DeploymentControlPlaneScope): boolean {
  return (
    (scope.kind === "deployment_id" && scope.value === deployment.deploymentId) ||
    (scope.kind === "provider_target_identity" &&
      scope.value === providerTargetIdentityFor(deployment)) ||
    (scope.kind === "lane_policy" && scope.value === deployment.lanePolicyRef)
  );
}

function synthesizeAuthorization(
  deployment: DeploymentTarget,
  role: DeploymentControlPlaneRole,
): DeploymentControlPlaneAuthorization {
  return {
    requestedBy: defaultRequestedBy(),
    grants: [{ role, scope: defaultScopeForRole(deployment, role) }],
  };
}

function authorize(
  deployment: DeploymentTarget,
  authorization: DeploymentControlPlaneAuthorization,
  requiredRoles: DeploymentControlPlaneRole[],
): DeploymentControlPlaneAuthorizationDecision {
  for (const role of requiredRoles) {
    const grant = authorization.grants.find(
      (entry) => entry.role === role && scopeMatches(deployment, entry.scope),
    );
    if (grant) {
      return {
        principal: authorization.requestedBy,
        role: grant.role,
        scope: grant.scope,
      };
    }
  }
  throw new DeploymentUnauthorizedError(
    `principal ${authorization.requestedBy.principalId} is not authorized for ${deployment.deploymentId}`,
  );
}

function requiredSubmitRoles(operationKind: string): DeploymentControlPlaneRole[] {
  return operationKind === "explicit_removal" || operationKind === "preview_cleanup"
    ? ["operator", "break_glass"]
    : ["submitter", "break_glass"];
}

export function authorizeControlPlaneSubmit(opts: {
  deployment: DeploymentTarget;
  operationKind: string;
  authorization?: DeploymentControlPlaneAuthorization;
}): DeploymentControlPlaneAuthorizationDecision {
  return authorize(
    opts.deployment,
    opts.authorization ||
      synthesizeAuthorization(opts.deployment, requiredSubmitRoles(opts.operationKind)[0]),
    requiredSubmitRoles(opts.operationKind),
  );
}

export function authorizeControlPlaneStatus(opts: {
  deployment: DeploymentTarget;
  authorization?: DeploymentControlPlaneAuthorization;
}): DeploymentControlPlaneAuthorizationDecision {
  return authorize(
    opts.deployment,
    opts.authorization || synthesizeAuthorization(opts.deployment, "submitter"),
    ["submitter", "approver", "operator", "break_glass"],
  );
}

export function authorizeControlPlaneRunAction(opts: {
  deployment: DeploymentTarget;
  action: DeploymentControlPlaneRunAction;
  authorization?: DeploymentControlPlaneAuthorization;
}): DeploymentControlPlaneAuthorizationDecision {
  const requiredRoles: DeploymentControlPlaneRole[] =
    opts.action === "resume" ? ["operator", "break_glass"] : ["operator", "break_glass"];
  return authorize(
    opts.deployment,
    opts.authorization || synthesizeAuthorization(opts.deployment, requiredRoles[0]),
    requiredRoles,
  );
}

export function grantsFor(
  requestedBy: DeploymentControlPlaneAuthorization["requestedBy"],
  grants: DeploymentControlPlaneGrant[],
): DeploymentControlPlaneAuthorization {
  return { requestedBy, grants };
}
