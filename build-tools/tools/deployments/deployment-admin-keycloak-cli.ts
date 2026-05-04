#!/usr/bin/env zx-wrapper
import { getFlagList, getFlagStr, getPositionals } from "../lib/cli";
import { resolveAllDeployments } from "./deployment-query";
import { resolveDeploymentForCli } from "./deployment-cli-resolve";
import {
  buildDeploymentAdminKeycloakPlan,
  grantDeploymentAdminKeycloakUser,
  printDeploymentAdminKeycloakResult,
  syncDeploymentAdminKeycloakRealm,
} from "./deployment-admin-keycloak";
import { handleDeploymentAdminVaultCli } from "./deployment-admin-vault-cli";
import {
  hasDeploymentAdminKeycloakRemoteProfileFlags,
  runDeploymentAdminKeycloakRemoteProfile,
} from "./deployment-admin-keycloak-remote";
import type { DeploymentAuthAction } from "./deployment-auth-groups";

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

function requireAction(): DeploymentAuthAction {
  const action = getFlagStr("action", "").trim() as DeploymentAuthAction;
  if (!["submit", "approve", "report_checks"].includes(action)) {
    throw new Error("--action must be one of submit, approve, report_checks");
  }
  return action;
}

function commandName(): string {
  const [, scope = "", command = ""] = getPositionals();
  if (!["identity", "keycloak", "vault"].includes(scope)) {
    throw new Error(
      'deploy admin currently supports the "identity" and "vault" namespaces (the deprecated "keycloak" alias still works)',
    );
  }
  return command;
}

function adminScope(): string {
  const [, scope = ""] = getPositionals();
  return scope;
}

function automationPrincipalIds(): string[] {
  return getFlagList("automation-principal");
}

function adminGroups(): string[] {
  return getFlagList("admin-group");
}

export async function maybeHandleDeploymentAdminCli(workspaceRoot: string): Promise<boolean> {
  const [group] = getPositionals();
  if (group !== "admin") return false;
  const deployment = await resolveDeploymentForCli(workspaceRoot, requireFlag, {
    deploymentJsonErrorMessage:
      "public repo-level deploy admin requires --deployment <label>; --deployment-json is not an operator source of truth",
  });
  const command = commandName();
  if (adminScope() === "vault") {
    return await handleDeploymentAdminVaultCli({ command, deployment });
  }
  if (command === "plan") {
    if (hasDeploymentAdminKeycloakRemoteProfileFlags()) {
      throw new Error(
        'deploy admin identity plan is read-only and does not support reviewed remote profile flags; use "sync" or "grant-user" with --profile <name>',
      );
    }
    printDeploymentAdminKeycloakResult(
      buildDeploymentAdminKeycloakPlan({
        deployment,
        automationPrincipalIds: automationPrincipalIds(),
      }),
    );
    return true;
  }
  if (command === "sync") {
    if (hasDeploymentAdminKeycloakRemoteProfileFlags()) {
      printDeploymentAdminKeycloakResult(
        await runDeploymentAdminKeycloakRemoteProfile({
          workspaceRoot,
          deployment,
          command: "sync",
          automationPrincipalIds: automationPrincipalIds(),
        }),
      );
      return true;
    }
    printDeploymentAdminKeycloakResult(
      await syncDeploymentAdminKeycloakRealm({
        deployment,
        deploymentsForRealm: await resolveAllDeployments(workspaceRoot),
        automationPrincipalIds: automationPrincipalIds(),
        realmFile: requireFlag("realm-file"),
        actingPrincipal: requireFlag("acting-principal"),
        adminGroups: adminGroups(),
      }),
    );
    return true;
  }
  if (command === "grant-user") {
    const action = requireAction();
    if (hasDeploymentAdminKeycloakRemoteProfileFlags()) {
      printDeploymentAdminKeycloakResult(
        await runDeploymentAdminKeycloakRemoteProfile({
          workspaceRoot,
          deployment,
          command: "grant-user",
          action,
          automationPrincipalIds: automationPrincipalIds(),
        }),
      );
      return true;
    }
    printDeploymentAdminKeycloakResult(
      await grantDeploymentAdminKeycloakUser({
        deployment,
        deploymentsForRealm: await resolveAllDeployments(workspaceRoot),
        automationPrincipalIds: automationPrincipalIds(),
        action,
        userEmail: requireFlag("user-email"),
        membershipFile: requireFlag("membership-file"),
        realmFile: getFlagStr("realm-file", "").trim() || undefined,
        actingPrincipal: requireFlag("acting-principal"),
        adminGroups: adminGroups(),
      }),
    );
    return true;
  }
  throw new Error("deploy admin identity command must be one of plan, sync, grant-user");
}
