#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import { reviewedDeployAdminGroupsByCapability } from "./deployment-admin-keycloak-auth.ts";
import {
  deploymentAuthActionCommand,
  deploymentAuthActionRole,
  type DeploymentAuthAction,
  reviewedAutomationGroupPatternsForDeployment,
  reviewedAutomationGroupsForPrincipal,
  reviewedHumanGroupName,
  reviewedHumanGroupsForDeployment,
} from "./deployment-auth-groups.ts";
import { buildDeploymentAuthKeycloakRealmImport } from "./deployment-auth-keycloak-realm.ts";

export const DEPLOYMENT_AUTH_GROUPS_SCHEMA = "deployment-auth-groups@1";
export const DEPLOYMENT_AUTH_ACTION_SCHEMA = "deployment-auth-action@1";

function deploymentSummary(deployment: DeploymentTarget) {
  return {
    deploymentId: deployment.deploymentId,
    label: deployment.label,
    environmentStage: deployment.environmentStage,
    provider: deployment.provider,
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function roleToken(role: ReturnType<typeof deploymentAuthActionRole>): string {
  return role === "submitter"
    ? "submitters"
    : role === "approver"
      ? "approvers"
      : "admission-reporters";
}

function automationGroupsByPrincipal(
  deployment: DeploymentTarget,
  automationPrincipalIds: string[],
) {
  return uniqueSorted(automationPrincipalIds).map((principalId) => ({
    principalId,
    groups: reviewedAutomationGroupsForPrincipal(deployment, principalId),
  }));
}

export function buildDeploymentAuthGroupSummary(
  deployment: DeploymentTarget,
  automationPrincipalIds: string[] = [],
) {
  const humanGroups = reviewedHumanGroupsForDeployment(deployment);
  const adminGroups = reviewedDeployAdminGroupsByCapability(deployment);
  return {
    schemaVersion: DEPLOYMENT_AUTH_GROUPS_SCHEMA,
    readOnly: true,
    deployment: deploymentSummary(deployment),
    humanGroups,
    automationGroupPatterns: reviewedAutomationGroupPatternsForDeployment(deployment),
    automationGroupsByPrincipal: automationGroupsByPrincipal(deployment, automationPrincipalIds),
    adminGroupConventions: adminGroups,
    exampleAdminCommands: [
      `deploy admin keycloak plan --deployment ${deployment.label}`,
      `deploy admin keycloak sync --deployment ${deployment.label} --realm-file /srv/common/deployment-auth-realm.json --acting-principal <principal> --admin-group ${adminGroups.shapeAdmin[0]}`,
    ],
    nextStep: deploymentAuthActionCommand(deployment, "submit"),
  };
}

export function buildDeploymentAuthActionSummary(
  deployment: DeploymentTarget,
  action: DeploymentAuthAction,
  automationPrincipalIds: string[] = [],
) {
  const role = deploymentAuthActionRole(action);
  const humanGroup = reviewedHumanGroupName(deployment, role);
  const adminGroups = reviewedDeployAdminGroupsByCapability(deployment);
  return {
    schemaVersion: DEPLOYMENT_AUTH_ACTION_SCHEMA,
    readOnly: true,
    deployment: deploymentSummary(deployment),
    action,
    requiredRole: role,
    humanGroup,
    automationGroupPatterns: reviewedAutomationGroupPatternsForDeployment(deployment).filter(
      (group) => group.includes(`-${roleToken(role)}-`),
    ),
    automationGroupsByPrincipal: automationGroupsByPrincipal(deployment, automationPrincipalIds),
    exampleAdminCommands: [
      `deploy admin keycloak plan --deployment ${deployment.label}`,
      `deploy admin keycloak grant-user --deployment ${deployment.label} --action ${action} --user-email <user@example.com> --membership-file /srv/common/deployment-auth-memberships.json --acting-principal <principal> --admin-group ${adminGroups.membershipAdmin[0]}`,
    ],
    nextStep: deploymentAuthActionCommand(deployment, action),
  };
}

export function buildDeploymentAuthKeycloakRealm(
  deployments: DeploymentTarget[],
  automationPrincipalIds: string[] = [],
) {
  return buildDeploymentAuthKeycloakRealmImport({ deployments, automationPrincipalIds });
}
