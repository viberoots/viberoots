#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
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

function exampleGroupCommands(groups: string[]): string[] {
  return groups.map(
    (group) => `kcadm.sh create groups -r deployments -s name=${JSON.stringify(group)}`,
  );
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
  return {
    schemaVersion: DEPLOYMENT_AUTH_GROUPS_SCHEMA,
    readOnly: true,
    deployment: deploymentSummary(deployment),
    humanGroups,
    automationGroupPatterns: reviewedAutomationGroupPatternsForDeployment(deployment),
    automationGroupsByPrincipal: automationGroupsByPrincipal(deployment, automationPrincipalIds),
    exampleAdminCommands: exampleGroupCommands(humanGroups),
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
      `kcadm.sh create groups -r deployments -s name=${JSON.stringify(humanGroup)}`,
      `deploy auth print-keycloak-realm > deployment-auth-realm.json`,
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
