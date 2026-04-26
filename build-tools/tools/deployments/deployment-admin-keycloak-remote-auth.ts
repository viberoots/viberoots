#!/usr/bin/env zx-wrapper
import { getFlagList, getFlagStr, hasFlag } from "../lib/cli.ts";
import type { DeploymentTarget } from "./contract.ts";
import {
  authorizeDeploymentKeycloakAdmin,
  reviewedDeployAdminGroupsByCapability,
  type DeploymentKeycloakAdminRole,
} from "./deployment-admin-keycloak-auth.ts";
import type { DeploymentAuthAction } from "./deployment-auth-groups.ts";
import {
  createAndWaitForServiceOwnedAuthSession,
  shouldUseServiceOwnedInteractiveAuth,
} from "./deployment-service-auth-client.ts";
import { readDeploymentAuthSessionViaService } from "./nixos-shared-host-control-plane-client.ts";
import type { NixosSharedHostRemotePlan } from "./nixos-shared-host-remote-target.ts";
import { requireServiceTokenFromEnv } from "./nixos-shared-host-service-client-config.ts";

type InputSource = "explicit" | "session";

export type ResolvedRemoteKeycloakAdminInputs = {
  actingPrincipal: string;
  principalEmail?: string;
  actingPrincipalSource: InputSource;
  adminGroups: string[];
  adminGroupsSource: InputSource;
  userEmail?: string;
  userEmailSource?: InputSource;
};

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

function adminGroups(): string[] {
  return getFlagList("admin-group")
    .map((value) => value.trim())
    .filter(Boolean);
}

function roleFor(command: "sync" | "grant-user"): DeploymentKeycloakAdminRole {
  return command === "sync" ? "shape_admin" : "membership_admin";
}

function operationKind(command: "sync" | "grant-user"): string {
  return command === "sync" ? "deploy-admin-keycloak-sync" : "deploy-admin-keycloak-grant-user";
}

function nextCommand(opts: {
  deployment: DeploymentTarget;
  profileName: string;
  command: "sync" | "grant-user";
  action?: DeploymentAuthAction;
  userEmail?: string;
}) {
  if (opts.command === "sync") {
    return `deploy admin keycloak sync --deployment ${opts.deployment.label} --profile ${opts.profileName}`;
  }
  return [
    `deploy admin keycloak grant-user --deployment ${opts.deployment.label}`,
    `--profile ${opts.profileName}`,
    `--action ${String(opts.action || "")}`,
    `--user-email ${String(opts.userEmail || "")}`,
  ].join(" ");
}

function authorizationFailure(opts: {
  deployment: DeploymentTarget;
  profileName: string;
  command: "sync" | "grant-user";
  action?: DeploymentAuthAction;
  principalId: string;
  principalEmail?: string;
  userEmail?: string;
}) {
  const expected = reviewedDeployAdminGroupsByCapability(opts.deployment);
  const role = roleFor(opts.command);
  const groups =
    role === "shape_admin"
      ? expected.shapeAdmin
      : role === "membership_admin"
        ? expected.membershipAdmin
        : expected.read;
  const identity = opts.principalEmail
    ? `${opts.principalId} (${opts.principalEmail})`
    : opts.principalId;
  const actionLabel = opts.command === "grant-user" ? ` for ${String(opts.action || "")}` : "";
  return new Error(
    `current login ${identity} lacks reviewed Keycloak ${role === "shape_admin" ? "group-shape admin" : "membership admin"}${actionLabel} on ${opts.deployment.label}; expected one of ${groups.join(", ")}; ask an authorized operator to run: ${nextCommand(opts)}`,
  );
}

async function resolveSessionBackedInputs(opts: {
  deployment: DeploymentTarget;
  plan: NixosSharedHostRemotePlan;
  command: "sync" | "grant-user";
  action?: DeploymentAuthAction;
}): Promise<ResolvedRemoteKeycloakAdminInputs> {
  if (hasFlag("acting-principal") || adminGroups().length > 0) {
    throw new Error(
      "reviewed remote Keycloak admin derives --acting-principal and --admin-group from the authenticated session; keep only --user-email for explicit cross-user grants",
    );
  }
  const controlPlaneToken = requireServiceTokenFromEnv(
    opts.plan.serviceClient.controlPlaneTokenEnv,
    `remote profile "${opts.plan.profileName}" Keycloak admin`,
  );
  const sessionId = await createAndWaitForServiceOwnedAuthSession({
    controlPlaneUrl: opts.plan.serviceClient.controlPlaneUrl,
    ...(controlPlaneToken ? { controlPlaneToken } : {}),
    deployment: opts.deployment,
    operationKind: operationKind(opts.command),
  });
  const status = await readDeploymentAuthSessionViaService({
    controlPlaneUrl: opts.plan.serviceClient.controlPlaneUrl,
    ...(controlPlaneToken ? { token: controlPlaneToken } : {}),
    sessionId,
  });
  const actingPrincipal = status.principal?.principalId || "";
  if (!actingPrincipal) {
    throw new Error("reviewed auth session completed without an authenticated principal");
  }
  const explicitUserEmail = getFlagStr("user-email", "").trim().toLowerCase();
  if (opts.command !== "grant-user") {
    return {
      actingPrincipal,
      ...(status.principalEmail ? { principalEmail: status.principalEmail } : {}),
      actingPrincipalSource: "session",
      adminGroups: status.reviewedKeycloakAdminGroups || [],
      adminGroupsSource: "session",
    };
  }
  const userEmail = explicitUserEmail || status.principalEmail || "";
  if (!userEmail) {
    throw new Error(
      `self-service grant could not infer a user email for ${actingPrincipal}; rerun with --user-email <user@example.com> to make the target explicit`,
    );
  }
  return {
    actingPrincipal,
    ...(status.principalEmail ? { principalEmail: status.principalEmail } : {}),
    actingPrincipalSource: "session",
    adminGroups: status.reviewedKeycloakAdminGroups || [],
    adminGroupsSource: "session",
    userEmail,
    userEmailSource: explicitUserEmail ? "explicit" : "session",
  };
}

function resolveExplicitInputs(opts: {
  command: "sync" | "grant-user";
}): ResolvedRemoteKeycloakAdminInputs {
  const groups = adminGroups();
  if (groups.length === 0) {
    throw new Error("reviewed remote Keycloak admin fallback requires at least one --admin-group");
  }
  return {
    actingPrincipal: requireFlag("acting-principal"),
    actingPrincipalSource: "explicit",
    adminGroups: groups,
    adminGroupsSource: "explicit",
    ...(opts.command === "grant-user"
      ? { userEmail: requireFlag("user-email").toLowerCase(), userEmailSource: "explicit" as const }
      : {}),
  };
}

export async function resolveRemoteKeycloakAdminInputs(opts: {
  deployment: DeploymentTarget;
  plan: NixosSharedHostRemotePlan;
  command: "sync" | "grant-user";
  action?: DeploymentAuthAction;
}) {
  const resolved = shouldUseServiceOwnedInteractiveAuth({ deployment: opts.deployment })
    ? await resolveSessionBackedInputs(opts)
    : resolveExplicitInputs(opts);
  try {
    authorizeDeploymentKeycloakAdmin({
      deployment: opts.deployment,
      principalId: resolved.actingPrincipal,
      adminGroups: resolved.adminGroups,
      role: roleFor(opts.command),
    });
  } catch {
    throw authorizationFailure({
      deployment: opts.deployment,
      profileName: opts.plan.profileName,
      command: opts.command,
      ...(opts.action ? { action: opts.action } : {}),
      principalId: resolved.actingPrincipal,
      ...(resolved.principalEmail ? { principalEmail: resolved.principalEmail } : {}),
      ...(resolved.userEmail ? { userEmail: resolved.userEmail } : {}),
    });
  }
  return resolved;
}
