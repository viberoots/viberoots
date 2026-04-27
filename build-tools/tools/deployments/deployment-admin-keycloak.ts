#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import type { DeploymentTarget } from "./contract.ts";
import { printDeployJson } from "./deploy-front-door.ts";
import {
  authorizeDeploymentKeycloakAdmin,
  reviewedDeployAdminGroupsByCapability,
} from "./deployment-admin-keycloak-auth.ts";
import {
  DEPLOYMENT_KEYCLOAK_MEMBERSHIP_REALM,
  grantUserInMembershipRealm,
  readDeploymentKeycloakMembershipRealm,
  writeDeploymentKeycloakMembershipRealm,
} from "./deployment-admin-keycloak-membership.ts";
import {
  reviewedDeploymentAdminMembershipFileExample,
  reviewedDeploymentAdminRealmFileExample,
} from "./deployment-admin-keycloak-artifacts.ts";
import {
  deploymentAuthActionRole,
  type DeploymentAuthAction,
  reviewedHumanGroupName,
} from "./deployment-auth-groups.ts";
import { buildDeploymentAuthKeycloakRealmImport } from "./deployment-auth-keycloak-realm.ts";
import { writeJsonDocument } from "./nixos-shared-host-io.ts";

export const DEPLOYMENT_ADMIN_KEYCLOAK_PLAN_SCHEMA = "deploy-admin-identity-plan@1";
export const DEPLOYMENT_ADMIN_KEYCLOAK_SYNC_SCHEMA = "deploy-admin-identity-sync@1";
export const DEPLOYMENT_ADMIN_KEYCLOAK_GRANT_USER_SCHEMA = "deploy-admin-identity-grant-user@1";

function deploymentSummary(deployment: DeploymentTarget) {
  return {
    deploymentId: deployment.deploymentId,
    label: deployment.label,
    environmentStage: deployment.environmentStage,
    provider: deployment.provider,
  };
}

function syncCommand(deployment: DeploymentTarget): string {
  return `deploy admin identity sync --deployment ${deployment.label} --realm-file ${reviewedDeploymentAdminRealmFileExample()} --acting-principal <principal> --admin-group <deploy-admin-identity-shape-admin-...>`;
}

function grantUserCommand(deployment: DeploymentTarget, action: DeploymentAuthAction): string {
  return `deploy admin identity grant-user --deployment ${deployment.label} --action ${action} --user-email <user@example.com> --membership-file ${reviewedDeploymentAdminMembershipFileExample()} --acting-principal <principal> --admin-group <deploy-admin-identity-membership-admin-...>`;
}

function auditRecord(
  principalId: string,
  authorization: ReturnType<typeof authorizeDeploymentKeycloakAdmin>,
  requestedMutation: Record<string, string>,
) {
  return {
    actingPrincipal: { principalId },
    grantedScope: authorization.scope,
    capability: authorization.role,
    requestedMutation,
  };
}

async function writeJsonIfChanged(filePath: string, value: unknown): Promise<boolean> {
  const next = JSON.stringify(value, null, 2) + "\n";
  let previous = "";
  try {
    previous = await fsp.readFile(filePath, "utf8");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (previous === next) return false;
  await writeJsonDocument(filePath, value);
  return true;
}

export function buildDeploymentAdminKeycloakPlan(opts: {
  deployment: DeploymentTarget;
  automationPrincipalIds?: string[];
}) {
  const desiredRealmImport = buildDeploymentAuthKeycloakRealmImport({
    deployments: [opts.deployment],
    automationPrincipalIds: opts.automationPrincipalIds || [],
  });
  return {
    schemaVersion: DEPLOYMENT_ADMIN_KEYCLOAK_PLAN_SCHEMA,
    readOnly: true,
    deployment: deploymentSummary(opts.deployment),
    adminGroupConventions: reviewedDeployAdminGroupsByCapability(opts.deployment),
    desiredRealmImport,
    plannedMutations: {
      realm: desiredRealmImport.realm,
      groups: desiredRealmImport.groups.map((group) => group.name),
      clients: desiredRealmImport.clients.map((client) => ({
        clientId: client.clientId,
        redirectUris: client.redirectUris,
        protocolMappers: client.protocolMappers.map((mapper) => mapper.name),
      })),
    },
    nextSteps: {
      sync: syncCommand(opts.deployment),
      grantSubmitter: grantUserCommand(opts.deployment, "submit"),
    },
  };
}

export async function syncDeploymentAdminKeycloakRealm(opts: {
  deployment: DeploymentTarget;
  deploymentsForRealm?: DeploymentTarget[];
  automationPrincipalIds?: string[];
  realmFile: string;
  actingPrincipal: string;
  adminGroups: string[];
}) {
  const authorization = authorizeDeploymentKeycloakAdmin({
    deployment: opts.deployment,
    principalId: opts.actingPrincipal,
    adminGroups: opts.adminGroups,
    role: "shape_admin",
  });
  const desiredRealmImport = buildDeploymentAuthKeycloakRealmImport({
    deployments: opts.deploymentsForRealm || [opts.deployment],
    automationPrincipalIds: opts.automationPrincipalIds || [],
  });
  const changed = await writeJsonIfChanged(opts.realmFile, desiredRealmImport);
  return {
    schemaVersion: DEPLOYMENT_ADMIN_KEYCLOAK_SYNC_SCHEMA,
    applied: true,
    changed,
    deployment: deploymentSummary(opts.deployment),
    realmFile: opts.realmFile,
    renderedDeploymentCount: (opts.deploymentsForRealm || [opts.deployment]).length,
    realmImport: desiredRealmImport,
    audit: auditRecord(opts.actingPrincipal, authorization, {
      kind: "identity_group_shape_sync",
      deploymentLabel: opts.deployment.label,
      realmFile: opts.realmFile,
    }),
  };
}

export async function grantDeploymentAdminKeycloakUser(opts: {
  deployment: DeploymentTarget;
  action: DeploymentAuthAction;
  userEmail: string;
  membershipFile: string;
  actingPrincipal: string;
  adminGroups: string[];
}) {
  const authorization = authorizeDeploymentKeycloakAdmin({
    deployment: opts.deployment,
    principalId: opts.actingPrincipal,
    adminGroups: opts.adminGroups,
    role: "membership_admin",
  });
  const role = deploymentAuthActionRole(opts.action);
  const group = reviewedHumanGroupName(opts.deployment, role);
  const realm = grantUserInMembershipRealm({
    realm: await readDeploymentKeycloakMembershipRealm(opts.membershipFile),
    action: opts.action,
    userEmail: opts.userEmail,
    group,
  });
  const changed = await writeDeploymentKeycloakMembershipRealm(opts.membershipFile, realm);
  return {
    schemaVersion: DEPLOYMENT_ADMIN_KEYCLOAK_GRANT_USER_SCHEMA,
    applied: true,
    changed,
    deployment: deploymentSummary(opts.deployment),
    membershipFile: opts.membershipFile,
    realm: DEPLOYMENT_KEYCLOAK_MEMBERSHIP_REALM,
    grantedUser: {
      userEmail: opts.userEmail.trim().toLowerCase(),
      action: opts.action,
      group,
      requiredRole: role,
    },
    audit: auditRecord(opts.actingPrincipal, authorization, {
      kind: "identity_membership_grant",
      deploymentLabel: opts.deployment.label,
      membershipFile: opts.membershipFile,
    }),
  };
}

export function printDeploymentAdminKeycloakResult(value: unknown) {
  printDeployJson(value);
}
