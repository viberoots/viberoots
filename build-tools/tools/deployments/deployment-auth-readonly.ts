#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { reviewedDeployAdminGroupsByCapability } from "./deployment-admin-keycloak-auth";
import {
  deploymentAuthActionCommand,
  deploymentAuthActionRole,
  type DeploymentAuthAction,
  reviewedRemoteKeycloakGrantUserCommand,
  reviewedRemoteKeycloakSyncCommand,
  reviewedAutomationGroupPatternsForDeployment,
  reviewedAutomationGroupsForPrincipal,
  reviewedHumanGroupName,
  reviewedHumanGroupsForDeployment,
} from "./deployment-auth-groups";
import { buildDeploymentAuthKeycloakRealmImport } from "./deployment-auth-keycloak-realm";

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
      `deploy admin identity plan --deployment ${deployment.label}`,
      reviewedRemoteKeycloakSyncCommand(deployment, { applyMode: "apply-host" }),
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
      `deploy admin identity plan --deployment ${deployment.label}`,
      reviewedRemoteKeycloakGrantUserCommand(deployment, action, { applyMode: "apply-host" }),
      reviewedRemoteKeycloakGrantUserCommand(deployment, action, {
        userEmail: "<user@example.com>",
        applyMode: "apply-host",
      }),
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
