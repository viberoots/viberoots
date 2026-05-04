#!/usr/bin/env zx-wrapper
import { getFlagList, getFlagStr, hasFlag } from "../lib/cli";
import type { DeploymentTarget } from "./contract";
import {
  authorizeDeploymentKeycloakAdmin,
  reviewedDeployAdminGroupsByCapability,
  type DeploymentKeycloakAdminRole,
} from "./deployment-admin-keycloak-auth";
import { reviewedPrincipalEmailRequirementMessage } from "./deployment-auth-session-reviewed-identity";
import {
  reviewedRemoteKeycloakGrantUserCommand,
  reviewedRemoteKeycloakSyncCommand,
  type DeploymentAuthAction,
} from "./deployment-auth-groups";
import {
  createAndWaitForServiceOwnedAuthSession,
  shouldUseServiceOwnedInteractiveAuth,
} from "./deployment-service-auth-client";
import { readDeploymentAuthSessionViaService } from "./nixos-shared-host-control-plane-client";
import type { NixosSharedHostRemotePlan } from "./nixos-shared-host-remote-target";
import { requireServiceTokenFromEnv } from "./nixos-shared-host-service-client-config";

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
  return command === "sync" ? "deploy-admin-identity-sync" : "deploy-admin-identity-grant-user";
}

function nextCommand(opts: {
  deployment: DeploymentTarget;
  profileName: string;
  command: "sync" | "grant-user";
  action?: DeploymentAuthAction;
  userEmail?: string;
}) {
  if (opts.command === "sync") {
    return reviewedRemoteKeycloakSyncCommand(opts.deployment, {
      profileName: opts.profileName,
      applyMode: "apply-host",
    });
  }
  return reviewedRemoteKeycloakGrantUserCommand(
    opts.deployment,
    (opts.action || "submit") as DeploymentAuthAction,
    {
      profileName: opts.profileName,
      ...(opts.userEmail ? { userEmail: opts.userEmail } : {}),
      applyMode: "apply-host",
    },
  );
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
    `current login ${identity} lacks reviewed identity ${role === "shape_admin" ? "group-shape admin" : "membership admin"}${actionLabel} on ${opts.deployment.label}; expected one of ${groups.join(", ")}; ask an authorized operator to run: ${nextCommand(opts)}`,
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
      "reviewed remote identity admin derives --acting-principal and --admin-group from the authenticated session; keep only --user-email for explicit cross-user grants",
    );
  }
  const controlPlaneToken = requireServiceTokenFromEnv(
    opts.plan.serviceClient.controlPlaneTokenEnv,
    `remote profile "${opts.plan.profileName}" identity admin`,
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
  if (!status.principalEmail) {
    throw new Error(reviewedPrincipalEmailRequirementMessage(actingPrincipal));
  }
  const explicitUserEmail = getFlagStr("user-email", "").trim().toLowerCase();
  if (opts.command !== "grant-user") {
    return {
      actingPrincipal,
      principalEmail: status.principalEmail,
      actingPrincipalSource: "session",
      adminGroups: status.reviewedIdentityAdminGroups || [],
      adminGroupsSource: "session",
    };
  }
  const userEmail = explicitUserEmail || status.principalEmail;
  return {
    actingPrincipal,
    principalEmail: status.principalEmail,
    actingPrincipalSource: "session",
    adminGroups: status.reviewedIdentityAdminGroups || [],
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
    throw new Error("reviewed remote identity admin fallback requires at least one --admin-group");
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
