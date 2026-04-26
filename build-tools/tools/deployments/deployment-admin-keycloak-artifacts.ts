#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  defaultManagedRoot,
  normalizeHostLogicalPath,
} from "./nixos-shared-host-install-contract.ts";

const IDENTITY_PROVIDER_DIR = "identity-provider";
const REALM_FILE = "deployment-auth-realm.json";
const MEMBERSHIP_FILE = "deployment-auth-memberships.json";

function relativeToConfigRoot(configRoot: string, managedRoot: string): string {
  const relative = path.posix.relative(configRoot, managedRoot);
  if (relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
    throw new Error(
      `reviewed Keycloak admin artifacts must stay under the reviewed config root: ${managedRoot}`,
    );
  }
  return relative;
}

function configRelativePath(configRoot: string, managedRoot: string, fileName: string): string {
  const relativeManagedRoot = relativeToConfigRoot(configRoot, managedRoot);
  return `./${path.posix.join(relativeManagedRoot || ".", IDENTITY_PROVIDER_DIR, fileName)}`;
}

export function deploymentAdminKeycloakArtifactPaths(opts: {
  configRoot: string;
  managedRoot?: string;
}) {
  const configRoot = normalizeHostLogicalPath(opts.configRoot);
  const managedRoot = normalizeHostLogicalPath(opts.managedRoot || defaultManagedRoot(configRoot));
  const identityProviderRoot = path.posix.join(managedRoot, IDENTITY_PROVIDER_DIR);
  return {
    configRoot,
    managedRoot,
    identityProviderRoot,
    realmFile: path.posix.join(identityProviderRoot, REALM_FILE),
    membershipFile: path.posix.join(identityProviderRoot, MEMBERSHIP_FILE),
    configRelativeRealmFile: configRelativePath(configRoot, managedRoot, REALM_FILE),
    configRelativeMembershipFile: configRelativePath(configRoot, managedRoot, MEMBERSHIP_FILE),
  };
}

export function reviewedDeploymentAdminRealmFileExample(): string {
  return "./deployment-host/identity-provider/deployment-auth-realm.json";
}

export function reviewedDeploymentAdminMembershipFileExample(): string {
  return "./deployment-host/identity-provider/deployment-auth-memberships.json";
}
