#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { deploymentAuthProjectSlug } from "./deployment-auth-groups";

export type DeploymentKeycloakAdminRole = "read" | "shape_admin" | "membership_admin";

export type DeploymentKeycloakAdminScope =
  | { kind: "project"; value: string }
  | { kind: "environment_stage"; value: string }
  | { kind: "global"; value: "all-deployments" };

export type DeploymentKeycloakAdminGrant = {
  role: DeploymentKeycloakAdminRole;
  scope: DeploymentKeycloakAdminScope;
};

export type DeploymentKeycloakAdminDecision = {
  principalId: string;
  role: DeploymentKeycloakAdminRole;
  scope: DeploymentKeycloakAdminScope;
};

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function roleToken(role: DeploymentKeycloakAdminRole): string {
  return role === "read" ? "read" : role === "shape_admin" ? "shape-admin" : "membership-admin";
}

function scopeToken(scope: DeploymentKeycloakAdminScope): string {
  return scope.kind === "project"
    ? `project-${normalized(scope.value)}`
    : scope.kind === "environment_stage"
      ? `environment-${normalized(scope.value)}`
      : "global";
}

function projectScope(deployment: DeploymentTarget): string {
  return normalized(deploymentAuthProjectSlug(deployment));
}

function environmentScope(deployment: DeploymentTarget): string {
  return normalized(deployment.environmentStage);
}

function parseAdminGroup(group: string): DeploymentKeycloakAdminGrant | undefined {
  const value = normalized(group);
  const globalMatch =
    /^deploy-admin-(identity|keycloak)-(read|shape-admin|membership-admin)-global$/.exec(value);
  if (globalMatch) {
    return {
      role: parseRole(globalMatch[2]),
      scope: { kind: "global", value: "all-deployments" },
    };
  }
  const scopedMatch =
    /^deploy-admin-(identity|keycloak)-(read|shape-admin|membership-admin)-(project|environment)-(.+)$/.exec(
      value,
    );
  if (!scopedMatch) return undefined;
  return {
    role: parseRole(scopedMatch[2]),
    scope:
      scopedMatch[3] === "project"
        ? { kind: "project", value: scopedMatch[4] }
        : { kind: "environment_stage", value: scopedMatch[4] },
  };
}

function parseRole(token: string): DeploymentKeycloakAdminRole {
  return token === "read" ? "read" : token === "shape-admin" ? "shape_admin" : "membership_admin";
}

function scopeMatches(deployment: DeploymentTarget, scope: DeploymentKeycloakAdminScope): boolean {
  return scope.kind === "project"
    ? normalized(scope.value) === projectScope(deployment)
    : scope.kind === "environment_stage"
      ? normalized(scope.value) === environmentScope(deployment)
      : true;
}

function roleLabel(role: DeploymentKeycloakAdminRole): string {
  return role === "read"
    ? "read-only inspection"
    : role === "shape_admin"
      ? "group-shape sync"
      : "membership mutation";
}

export function normalizeReviewedDeployAdminGroups(groups: string[]): string[] {
  return [
    ...new Set(
      groups
        .map(parseAdminGroup)
        .filter((group): group is DeploymentKeycloakAdminGrant => !!group)
        .map((group) => reviewedDeployAdminGroupName(group.role, group.scope)),
    ),
  ].sort();
}

export function reviewedDeployAdminGroupName(
  role: DeploymentKeycloakAdminRole,
  scope: DeploymentKeycloakAdminScope,
): string {
  return `deploy-admin-identity-${roleToken(role)}-${scopeToken(scope)}`;
}

export function reviewedDeployAdminGroupsByCapability(deployment: DeploymentTarget) {
  const project = { kind: "project" as const, value: projectScope(deployment) };
  const environment = { kind: "environment_stage" as const, value: environmentScope(deployment) };
  const global = { kind: "global" as const, value: "all-deployments" as const };
  return {
    read: [project, environment, global].map((scope) =>
      reviewedDeployAdminGroupName("read", scope),
    ),
    shapeAdmin: [project, environment, global].map((scope) =>
      reviewedDeployAdminGroupName("shape_admin", scope),
    ),
    membershipAdmin: [project, environment, global].map((scope) =>
      reviewedDeployAdminGroupName("membership_admin", scope),
    ),
  };
}

function preferredAdminGroups(
  deployment: DeploymentTarget,
  role: DeploymentKeycloakAdminRole,
  adminGroups: string[],
): string[] {
  const normalizedGroups = new Set(normalizeReviewedDeployAdminGroups(adminGroups));
  const expected = reviewedDeployAdminGroupsByCapability(deployment);
  const preferred =
    role === "read"
      ? expected.read
      : role === "shape_admin"
        ? expected.shapeAdmin
        : expected.membershipAdmin;
  const matched = preferred.filter((group) => normalizedGroups.has(group));
  return matched.length > 0 ? matched : [...normalizedGroups];
}

export function authorizeDeploymentKeycloakAdmin(opts: {
  deployment: DeploymentTarget;
  principalId: string;
  adminGroups: string[];
  role: DeploymentKeycloakAdminRole;
}): DeploymentKeycloakAdminDecision {
  const grant = preferredAdminGroups(opts.deployment, opts.role, opts.adminGroups)
    .map(parseAdminGroup)
    .filter((entry): entry is DeploymentKeycloakAdminGrant => !!entry)
    .find((entry) => entry.role === opts.role && scopeMatches(opts.deployment, entry.scope));
  if (!grant) {
    const expected = reviewedDeployAdminGroupsByCapability(opts.deployment);
    const examples =
      opts.role === "read"
        ? expected.read
        : opts.role === "shape_admin"
          ? expected.shapeAdmin
          : expected.membershipAdmin;
    throw new Error(
      `principal ${opts.principalId} is not authorized for reviewed identity ${roleLabel(opts.role)} on ${opts.deployment.label}; expected admin groups include ${examples.join(", ")}; inspect deploy admin identity plan --deployment ${opts.deployment.label}`,
    );
  }
  return { principalId: opts.principalId, role: opts.role, scope: grant.scope };
}
