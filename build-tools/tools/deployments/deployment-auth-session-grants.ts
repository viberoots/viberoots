#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import type { JwtClaims } from "./deploy-vault-jwt-claims.ts";
import {
  deploymentAuthProjectSlug,
  reviewedAutomationGroupName,
  reviewedHumanGroupName,
} from "./deployment-auth-groups.ts";
import { projectScopeValueFor } from "./deployment-control-plane-authorization-shared.ts";
import type {
  DeploymentControlPlaneGrant,
  DeploymentControlPlaneRole,
} from "./deployment-control-plane-contract.ts";

function claimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function claimValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function humanGrant(
  deployment: DeploymentTarget,
  role: "submitter" | "approver" | "admission_reporter",
): DeploymentControlPlaneGrant {
  return {
    role,
    scope: { kind: "deployment_id", value: deployment.deploymentId },
  };
}

function humanGrantsForGroups(
  deployment: DeploymentTarget,
  groups: Set<string>,
): DeploymentControlPlaneGrant[] {
  const matched: Array<DeploymentControlPlaneGrant | undefined> = [
    groups.has(reviewedHumanGroupName(deployment, "submitter"))
      ? humanGrant(deployment, "submitter")
      : undefined,
    groups.has(reviewedHumanGroupName(deployment, "approver"))
      ? humanGrant(deployment, "approver")
      : undefined,
    groups.has(reviewedHumanGroupName(deployment, "admission_reporter"))
      ? humanGrant(deployment, "admission_reporter")
      : undefined,
  ];
  return matched.filter((grant): grant is DeploymentControlPlaneGrant => !!grant);
}

function automationIdentityVariants(value: string): string[] {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return [];
  const identities = new Set([normalized]);
  if (normalized.startsWith("service-account-")) {
    identities.add(normalized.slice("service-account-".length));
  }
  return [...identities].filter(Boolean);
}

function automationPrincipalIds(claims: JwtClaims): string[] {
  const identities = new Set<string>();
  for (const value of [
    claimText(claims.azp),
    claimText(claims.client_id),
    claimText(claims.preferred_username),
    claimText(claims.sub),
  ]) {
    for (const identity of automationIdentityVariants(value)) {
      identities.add(identity);
    }
  }
  return [...identities];
}

function automationGrant(
  deployment: DeploymentTarget,
  role: DeploymentControlPlaneRole,
  scope: "project" | "environment_stage" | "admission_domain",
): DeploymentControlPlaneGrant {
  if (scope === "project") {
    return {
      role,
      scope: { kind: "project", value: projectScopeValueFor(deployment) },
    };
  }
  if (scope === "environment_stage") {
    return {
      role,
      scope: { kind: "environment_stage", value: deployment.environmentStage },
    };
  }
  return {
    role,
    scope: { kind: "admission_domain", value: "all_deployments" },
  };
}

function automationGrantsForPrincipal(
  deployment: DeploymentTarget,
  groups: Set<string>,
  principalId: string,
): DeploymentControlPlaneGrant[] {
  const project = deploymentAuthProjectSlug(deployment);
  const environment = deployment.environmentStage;
  const matched: Array<DeploymentControlPlaneGrant | undefined> = [
    groups.has(reviewedAutomationGroupName(principalId, "submitter", "project", project))
      ? automationGrant(deployment, "submitter", "project")
      : undefined,
    groups.has(reviewedAutomationGroupName(principalId, "approver", "project", project))
      ? automationGrant(deployment, "approver", "project")
      : undefined,
    groups.has(reviewedAutomationGroupName(principalId, "admission_reporter", "project", project))
      ? automationGrant(deployment, "admission_reporter", "project")
      : undefined,
    groups.has(reviewedAutomationGroupName(principalId, "submitter", "environment", environment))
      ? automationGrant(deployment, "submitter", "environment_stage")
      : undefined,
    groups.has(reviewedAutomationGroupName(principalId, "approver", "environment", environment))
      ? automationGrant(deployment, "approver", "environment_stage")
      : undefined,
    groups.has(
      reviewedAutomationGroupName(principalId, "admission_reporter", "environment", environment),
    )
      ? automationGrant(deployment, "admission_reporter", "environment_stage")
      : undefined,
    groups.has(
      reviewedAutomationGroupName(
        principalId,
        "admission_reporter",
        "admission_domain",
        "all-deployments",
      ),
    )
      ? automationGrant(deployment, "admission_reporter", "admission_domain")
      : undefined,
  ];
  return matched.filter((grant): grant is DeploymentControlPlaneGrant => !!grant);
}

export function oidcGrantsForDeployment(opts: {
  deployment: DeploymentTarget;
  claims: JwtClaims;
}): DeploymentControlPlaneGrant[] {
  const groups = new Set(claimValues(opts.claims.groups));
  const humanGrants = humanGrantsForGroups(opts.deployment, groups);
  const automationGrants = automationPrincipalIds(opts.claims).flatMap((principalId) =>
    automationGrantsForPrincipal(opts.deployment, groups, principalId),
  );
  return [...humanGrants, ...automationGrants];
}
