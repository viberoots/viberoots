#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import type { DeploymentAuthAction } from "./deployment-auth-groups.ts";
import { writeJsonDocument } from "./nixos-shared-host-io.ts";

export const DEPLOYMENT_KEYCLOAK_MEMBERSHIP_REALM = "deployments";

type KeycloakUser = Record<string, unknown> & {
  username?: string;
  email?: string;
  groups?: unknown;
};

export type DeploymentKeycloakMembershipRealm = Record<string, unknown> & {
  realm: string;
  enabled: boolean;
  users: KeycloakUser[];
};

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseRealm(raw: string, filePath: string): DeploymentKeycloakMembershipRealm {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${filePath}: failed to parse JSON (${String(error)})`);
  }
  const doc = parsed as Partial<DeploymentKeycloakMembershipRealm>;
  const realm = typeof doc.realm === "string" && doc.realm.trim() ? doc.realm : "";
  if (realm && realm !== DEPLOYMENT_KEYCLOAK_MEMBERSHIP_REALM) {
    throw new Error(`${filePath}: expected realm "${DEPLOYMENT_KEYCLOAK_MEMBERSHIP_REALM}"`);
  }
  return {
    ...(doc as Record<string, unknown>),
    realm: DEPLOYMENT_KEYCLOAK_MEMBERSHIP_REALM,
    enabled: doc.enabled !== false,
    users: Array.isArray(doc.users) ? (doc.users as KeycloakUser[]) : [],
  };
}

export async function readDeploymentKeycloakMembershipRealm(
  filePath: string,
): Promise<DeploymentKeycloakMembershipRealm> {
  try {
    return parseRealm(await fsp.readFile(filePath, "utf8"), filePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return {
        realm: DEPLOYMENT_KEYCLOAK_MEMBERSHIP_REALM,
        enabled: true,
        users: [],
      };
    }
    throw error;
  }
}

function keyForUser(user: KeycloakUser): string {
  return normalizedEmail(
    typeof user.email === "string" && user.email.trim()
      ? user.email
      : typeof user.username === "string"
        ? user.username
        : "",
  );
}

export function grantUserInMembershipRealm(opts: {
  realm: DeploymentKeycloakMembershipRealm;
  action: DeploymentAuthAction;
  userEmail: string;
  group: string;
}): DeploymentKeycloakMembershipRealm {
  const wanted = normalizedEmail(opts.userEmail);
  const existing = opts.realm.users.find((user) => keyForUser(user) === wanted);
  const currentGroups = Array.isArray(existing?.groups)
    ? existing.groups.filter((value): value is string => typeof value === "string")
    : [];
  const users = opts.realm.users
    .filter((user) => keyForUser(user) !== wanted)
    .concat({
      ...(existing || {}),
      username: wanted,
      email: wanted,
      enabled: existing?.enabled !== false,
      emailVerified: existing?.emailVerified === true,
      groups: [...new Set([...currentGroups, opts.group])].sort(),
      attributes: {
        ...((existing?.attributes as Record<string, unknown> | undefined) || {}),
        "deploy-admin-last-action": [opts.action],
      },
    })
    .sort((left, right) => keyForUser(left).localeCompare(keyForUser(right)));
  return { ...opts.realm, realm: DEPLOYMENT_KEYCLOAK_MEMBERSHIP_REALM, enabled: true, users };
}

export async function writeDeploymentKeycloakMembershipRealm(
  filePath: string,
  realm: DeploymentKeycloakMembershipRealm,
): Promise<boolean> {
  const next = JSON.stringify(realm, null, 2) + "\n";
  let previous = "";
  try {
    previous = await fsp.readFile(filePath, "utf8");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (previous === next) return false;
  await writeJsonDocument(filePath, realm);
  return true;
}
