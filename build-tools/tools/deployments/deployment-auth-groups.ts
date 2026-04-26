#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { DeploymentTarget } from "./contract.ts";
import { projectScopeValueFor } from "./deployment-control-plane-authorization-shared.ts";
import type { DeploymentControlPlaneRole } from "./deployment-control-plane-contract.ts";

export type DeploymentAuthRole = Extract<
  DeploymentControlPlaneRole,
  "submitter" | "approver" | "admission_reporter"
>;

export type DeploymentAuthAction = "submit" | "approve" | "report_checks";

type DeploymentAuthAutomationScope = "project" | "environment" | "admission_domain";

function roleToken(role: DeploymentAuthRole): string {
  return role === "submitter"
    ? "submitters"
    : role === "approver"
      ? "approvers"
      : "admission-reporters";
}

function normalizedPrincipalValue(principalId: string): string {
  const normalized = principalId
    .trim()
    .toLowerCase()
    .replace(/^oidc:/, "");
  return normalized.startsWith("service-account-")
    ? normalized.slice("service-account-".length)
    : normalized;
}

export function deploymentAuthProjectSlug(deployment: DeploymentTarget): string {
  return path.posix.basename(projectScopeValueFor(deployment));
}

export function deploymentAuthActionRole(action: DeploymentAuthAction): DeploymentAuthRole {
  return action === "submit"
    ? "submitter"
    : action === "approve"
      ? "approver"
      : "admission_reporter";
}

export function deploymentAuthActionCommand(
  deployment: DeploymentTarget,
  action: DeploymentAuthAction,
): string {
  return `deploy auth explain-groups --deployment ${deployment.label} --action ${action}`;
}

export function deploymentAuthGroupSuffix(deployment: DeploymentTarget): string {
  return `${deploymentAuthProjectSlug(deployment)}-${deployment.environmentStage}`;
}

export function reviewedHumanGroupName(
  deployment: DeploymentTarget,
  role: DeploymentAuthRole,
): string {
  return `deploy-${roleToken(role)}-${deploymentAuthGroupSuffix(deployment)}`;
}

export function reviewedHumanGroupsForDeployment(deployment: DeploymentTarget): string[] {
  return (["submitter", "approver", "admission_reporter"] as DeploymentAuthRole[]).map((role) =>
    reviewedHumanGroupName(deployment, role),
  );
}

export function reviewedAutomationGroupName(
  principalId: string,
  role: DeploymentAuthRole,
  scope: DeploymentAuthAutomationScope,
  value: string,
): string {
  const principal = normalizedPrincipalValue(principalId);
  const token = roleToken(role);
  return scope === "project"
    ? `deploy-automation-${principal}-${token}-project-${value}`
    : `deploy-automation-${principal}-${token}-${value}`;
}

export function reviewedAutomationGroupPatternsForDeployment(
  deployment: DeploymentTarget,
): string[] {
  const project = deploymentAuthProjectSlug(deployment);
  const environment = deployment.environmentStage;
  return [
    reviewedAutomationGroupName("<principal>", "submitter", "project", project),
    reviewedAutomationGroupName("<principal>", "approver", "project", project),
    reviewedAutomationGroupName("<principal>", "admission_reporter", "project", project),
    reviewedAutomationGroupName("<principal>", "submitter", "environment", environment),
    reviewedAutomationGroupName("<principal>", "approver", "environment", environment),
    reviewedAutomationGroupName("<principal>", "admission_reporter", "environment", environment),
    reviewedAutomationGroupName(
      "<principal>",
      "admission_reporter",
      "admission_domain",
      "all-deployments",
    ),
  ];
}

export function reviewedAutomationGroupsForPrincipal(
  deployment: DeploymentTarget,
  principalId: string,
): string[] {
  const project = deploymentAuthProjectSlug(deployment);
  const environment = deployment.environmentStage;
  return [
    reviewedAutomationGroupName(principalId, "submitter", "project", project),
    reviewedAutomationGroupName(principalId, "approver", "project", project),
    reviewedAutomationGroupName(principalId, "admission_reporter", "project", project),
    reviewedAutomationGroupName(principalId, "submitter", "environment", environment),
    reviewedAutomationGroupName(principalId, "approver", "environment", environment),
    reviewedAutomationGroupName(principalId, "admission_reporter", "environment", environment),
    reviewedAutomationGroupName(
      principalId,
      "admission_reporter",
      "admission_domain",
      "all-deployments",
    ),
  ];
}

export function isAutomationLikePrincipal(principalId: string): boolean {
  const normalized = principalId.trim().toLowerCase();
  return normalized.startsWith("oidc:service-account-") || normalized.startsWith("app:");
}

function exampleHumanGrantCommand(
  deployment: DeploymentTarget,
  action: DeploymentAuthAction,
): string {
  return `deploy admin keycloak grant-user --deployment ${deployment.label} --action ${action} --user-email <user@example.com> --membership-file /srv/common/deployment-auth-memberships.json --acting-principal <principal> --admin-group <deploy-admin-keycloak-membership-admin-...>`;
}

export function deploymentAuthMissingGrantHint(opts: {
  deployment: DeploymentTarget;
  role: DeploymentAuthRole;
  principalId: string;
}): string {
  const action = roleAction(opts.role);
  const command = deploymentAuthActionCommand(opts.deployment, action);
  if (isAutomationLikePrincipal(opts.principalId)) {
    const groups = reviewedAutomationGroupsForPrincipal(opts.deployment, opts.principalId).join(
      ", ",
    );
    return ` expected automation groups include ${groups}; inspect ${command}`;
  }
  const group = reviewedHumanGroupName(opts.deployment, opts.role);
  return ` expected human group ${group}; example admin command: ${exampleHumanGrantCommand(opts.deployment, action)}; inspect ${command}`;
}

function roleAction(role: DeploymentAuthRole): DeploymentAuthAction {
  return role === "submitter" ? "submit" : role === "approver" ? "approve" : "report_checks";
}
