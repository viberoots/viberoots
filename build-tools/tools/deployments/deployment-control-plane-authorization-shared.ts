#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { DeploymentTarget } from "./contract";
import type {
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneRole,
  DeploymentControlPlaneScope,
} from "./deployment-control-plane-contract";
import { packagePathFromLabel } from "../lib/labels";

function projectScopeValueForLabel(label: string): string {
  const packageName = path.posix.basename(packagePathFromLabel(label));
  return `projects/deployments/${packageName}`;
}

export function projectScopeValueFor(deployment: DeploymentTarget): string {
  const lanePackage = path.posix.basename(packagePathFromLabel(deployment.lanePolicyRef || ""));
  if (lanePackage.endsWith("-shared")) {
    return `projects/deployments/${lanePackage.slice(0, -"-shared".length)}`;
  }
  const deploymentProject = projectScopeValueForLabel(deployment.label);
  const suffix = deployment.environmentStage ? `-${deployment.environmentStage}` : "";
  return suffix && deploymentProject.endsWith(suffix)
    ? deploymentProject.slice(0, -suffix.length)
    : deploymentProject;
}

function requestedBy(authorization: DeploymentControlPlaneAuthorization["requestedBy"]) {
  return {
    principalId: authorization.principalId,
    ...(authorization.displayName ? { displayName: authorization.displayName } : {}),
  };
}

function scopeKey(scope: DeploymentControlPlaneScope): string {
  return `${scope.kind}:${scope.value}`;
}

function scopeRank(scope: DeploymentControlPlaneScope): number {
  return (
    {
      deployment_id: 0,
      project: 1,
      environment_stage: 2,
      admission_domain: 3,
      provider_target_identity: 4,
      lane_policy: 5,
      break_glass_incident: 6,
      bootstrap_deployment: 7,
    }[scope.kind] ?? 99
  );
}

function roleRank(role: DeploymentControlPlaneRole): number {
  return (
    {
      submitter: 0,
      approver: 1,
      admission_reporter: 2,
      operator: 3,
      break_glass: 4,
      bootstrap: 5,
    }[role] ?? 99
  );
}

export function normalizeAuthorizationSnapshot(
  authorization: DeploymentControlPlaneAuthorization,
): DeploymentControlPlaneAuthorization {
  const grants = Array.from(
    new Map(
      authorization.grants.map((grant) => [
        `${grant.role}:${scopeKey(grant.scope)}`,
        { role: grant.role, scope: { kind: grant.scope.kind, value: grant.scope.value } },
      ]),
    ).values(),
  ).sort(
    (left, right) =>
      roleRank(left.role) - roleRank(right.role) ||
      scopeRank(left.scope) - scopeRank(right.scope) ||
      scopeKey(left.scope).localeCompare(scopeKey(right.scope)),
  );
  return { requestedBy: requestedBy(authorization.requestedBy), grants };
}
