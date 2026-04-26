#!/usr/bin/env zx-wrapper
import { getFlagList, getFlagStr, getPositionals } from "../lib/cli.ts";
import { resolveDeploymentForCli } from "./deployment-cli-resolve.ts";
import {
  buildDeploymentAdminKeycloakPlan,
  grantDeploymentAdminKeycloakUser,
  printDeploymentAdminKeycloakResult,
  syncDeploymentAdminKeycloakRealm,
} from "./deployment-admin-keycloak.ts";
import type { DeploymentAuthAction } from "./deployment-auth-groups.ts";

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
  if (scope !== "keycloak") {
    throw new Error('deploy admin currently supports only the "keycloak" namespace');
  }
  return command;
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
  if (command === "plan") {
    printDeploymentAdminKeycloakResult(
      buildDeploymentAdminKeycloakPlan({
        deployment,
        automationPrincipalIds: automationPrincipalIds(),
      }),
    );
    return true;
  }
  if (command === "sync") {
    printDeploymentAdminKeycloakResult(
      await syncDeploymentAdminKeycloakRealm({
        deployment,
        automationPrincipalIds: automationPrincipalIds(),
        realmFile: requireFlag("realm-file"),
        actingPrincipal: requireFlag("acting-principal"),
        adminGroups: adminGroups(),
      }),
    );
    return true;
  }
  if (command === "grant-user") {
    printDeploymentAdminKeycloakResult(
      await grantDeploymentAdminKeycloakUser({
        deployment,
        action: requireAction(),
        userEmail: requireFlag("user-email"),
        membershipFile: requireFlag("membership-file"),
        actingPrincipal: requireFlag("acting-principal"),
        adminGroups: adminGroups(),
      }),
    );
    return true;
  }
  throw new Error("deploy admin keycloak command must be one of plan, sync, grant-user");
}
