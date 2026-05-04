#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { providerTargetIdentityFor } from "./contract";
import { defaultRequestedBy } from "./deployment-admission-evidence";
import { deploymentAuthMissingGrantHint } from "./deployment-auth-groups";
import {
  type DeploymentControlPlaneAuthorization,
  type DeploymentControlPlaneAuthorizationDecision,
  type DeploymentControlPlaneGrant,
  type DeploymentControlPlaneRole,
  type DeploymentControlPlaneRunAction,
  type DeploymentControlPlaneScope,
} from "./deployment-control-plane-contract";
import { DeploymentUnauthorizedError } from "./deployment-control-plane-errors";
import {
  normalizeAuthorizationSnapshot,
  projectScopeValueFor,
} from "./deployment-control-plane-authorization-shared";
export { normalizeAuthorizationSnapshot } from "./deployment-control-plane-authorization-shared";

function defaultScopeForRole(
  deployment: DeploymentTarget,
  role: DeploymentControlPlaneRole,
): DeploymentControlPlaneScope {
  if (role === "bootstrap") {
    return { kind: "bootstrap_deployment", value: deployment.deploymentId };
  }
  if (role === "submitter" || role === "approver" || role === "admission_reporter") {
    return { kind: "deployment_id", value: deployment.deploymentId };
  }
  return {
    kind: "provider_target_identity",
    value: providerTargetIdentityFor(deployment),
  };
}

function scopeMatchesForRole(
  deployment: DeploymentTarget,
  role: DeploymentControlPlaneRole,
  scope: DeploymentControlPlaneScope,
): boolean {
  if (role === "operator") {
    return (
      (scope.kind === "provider_target_identity" &&
        scope.value === providerTargetIdentityFor(deployment)) ||
      (scope.kind === "lane_policy" && scope.value === deployment.lanePolicyRef)
    );
  }
  if (role === "submitter" || role === "approver" || role === "admission_reporter") {
    return (
      (scope.kind === "deployment_id" && scope.value === deployment.deploymentId) ||
      (scope.kind === "project" && scope.value === projectScopeValueFor(deployment)) ||
      (scope.kind === "environment_stage" && scope.value === deployment.environmentStage) ||
      (role === "admission_reporter" &&
        scope.kind === "admission_domain" &&
        scope.value === "all_deployments")
    );
  }
  if (role === "bootstrap") {
    return scope.kind === "bootstrap_deployment" && scope.value === deployment.deploymentId;
  }
  return false;
}

function synthesizeAuthorization(
  deployment: DeploymentTarget,
  role: DeploymentControlPlaneRole,
): DeploymentControlPlaneAuthorization {
  return normalizeAuthorizationSnapshot({
    requestedBy: defaultRequestedBy(),
    grants: [{ role, scope: defaultScopeForRole(deployment, role) }],
  });
}

function missingRoleFor(requiredRoles: DeploymentControlPlaneRole[]): DeploymentControlPlaneRole {
  return requiredRoles.find((role) => role !== "break_glass") || requiredRoles[0] || "submitter";
}

function missingGrantMessage(opts: {
  deployment: DeploymentTarget;
  authorization: DeploymentControlPlaneAuthorization;
  requiredRoles: DeploymentControlPlaneRole[];
  actionDescription: string;
}): string {
  const missingRole = missingRoleFor(opts.requiredRoles);
  const normalized = normalizeAuthorizationSnapshot(opts.authorization);
  const base =
    `principal ${normalized.requestedBy.principalId} is not authorized to ${opts.actionDescription} ` +
    `on ${opts.deployment.deploymentId}: missing ${missingRole} grant`;
  return missingRole === "submitter" ||
    missingRole === "approver" ||
    missingRole === "admission_reporter"
    ? `${base};${deploymentAuthMissingGrantHint({
        deployment: opts.deployment,
        role: missingRole,
        principalId: normalized.requestedBy.principalId,
      })}`
    : base;
}

function authorize(
  deployment: DeploymentTarget,
  authorization: DeploymentControlPlaneAuthorization,
  requiredRoles: DeploymentControlPlaneRole[],
  actionDescription: string,
): DeploymentControlPlaneAuthorizationDecision {
  const normalized = normalizeAuthorizationSnapshot(authorization);
  for (const role of requiredRoles) {
    const grant = normalized.grants.find(
      (entry) => entry.role === role && scopeMatchesForRole(deployment, role, entry.scope),
    );
    if (grant) {
      return {
        principal: normalized.requestedBy,
        role: grant.role,
        scope: grant.scope,
      };
    }
  }
  throw new DeploymentUnauthorizedError(
    missingGrantMessage({
      deployment,
      authorization: normalized,
      requiredRoles,
      actionDescription,
    }),
  );
}

function requiredSubmitRoles(operationKind: string): DeploymentControlPlaneRole[] {
  return operationKind === "explicit_removal" ||
    operationKind === "preview_cleanup" ||
    operationKind === "retire_target" ||
    operationKind === "migrate_target"
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
    "submit a deploy",
  );
}

export function authorizeControlPlaneStatus(opts: {
  deployment: DeploymentTarget;
  authorization?: DeploymentControlPlaneAuthorization;
}): DeploymentControlPlaneAuthorizationDecision {
  return authorize(
    opts.deployment,
    opts.authorization || synthesizeAuthorization(opts.deployment, "submitter"),
    ["submitter", "approver", "admission_reporter", "operator", "break_glass"],
    "read deployment status",
  );
}

export function authorizeControlPlaneRunAction(opts: {
  deployment: DeploymentTarget;
  action: DeploymentControlPlaneRunAction;
  authorization?: DeploymentControlPlaneAuthorization;
}): DeploymentControlPlaneAuthorizationDecision {
  const requiredRoles: DeploymentControlPlaneRole[] =
    opts.action === "approve"
      ? ["approver", "break_glass"]
      : opts.action === "resume"
        ? ["operator", "break_glass"]
        : ["operator", "break_glass"];
  return authorize(
    opts.deployment,
    opts.authorization || synthesizeAuthorization(opts.deployment, requiredRoles[0]),
    requiredRoles,
    opts.action === "approve" ? "approve a deploy" : `${opts.action} a deploy`,
  );
}

export function authorizeControlPlaneBreakGlass(opts: {
  deployment: DeploymentTarget;
  incidentRef: string;
  authorization: DeploymentControlPlaneAuthorization;
}): DeploymentControlPlaneAuthorizationDecision {
  const grant = opts.authorization.grants.find(
    (entry) => entry.role === "break_glass" && entry.scope.kind === "break_glass_incident",
  );
  if (!grant || grant.scope.value !== opts.incidentRef) {
    throw new DeploymentUnauthorizedError(
      `principal ${opts.authorization.requestedBy.principalId} is not authorized for break-glass incident ${opts.incidentRef} on ${opts.deployment.deploymentId}`,
    );
  }
  return {
    principal: opts.authorization.requestedBy,
    role: grant.role,
    scope: grant.scope,
  };
}

export function authorizeControlPlaneBootstrap(opts: {
  deployment: DeploymentTarget;
  authorization: DeploymentControlPlaneAuthorization;
}): DeploymentControlPlaneAuthorizationDecision {
  const grant = opts.authorization.grants.find(
    (entry) =>
      entry.role === "bootstrap" &&
      entry.scope.kind === "bootstrap_deployment" &&
      entry.scope.value === opts.deployment.deploymentId,
  );
  if (!grant) {
    throw new DeploymentUnauthorizedError(
      `principal ${opts.authorization.requestedBy.principalId} is not authorized for bootstrap on ${opts.deployment.deploymentId}`,
    );
  }
  return {
    principal: opts.authorization.requestedBy,
    role: grant.role,
    scope: grant.scope,
  };
}

export function authorizeControlPlaneAdmissionReport(opts: {
  deployment: DeploymentTarget;
  authorization: DeploymentControlPlaneAuthorization;
}): DeploymentControlPlaneAuthorizationDecision {
  return authorize(
    opts.deployment,
    opts.authorization,
    ["admission_reporter"],
    "report admission evidence",
  );
}

export function grantsFor(
  requestedBy: DeploymentControlPlaneAuthorization["requestedBy"],
  grants: DeploymentControlPlaneGrant[],
): DeploymentControlPlaneAuthorization {
  return normalizeAuthorizationSnapshot({ requestedBy, grants });
}
