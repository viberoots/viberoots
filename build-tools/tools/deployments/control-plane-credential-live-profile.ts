import * as fsp from "node:fs/promises";
import type { InfisicalCredentialConfig } from "./deployment-secret-infisical-credentials";
import type { InfisicalLeastPrivilegeScope } from "./control-plane-credential-staging-types";

export type LiveInfisicalBackendProfile = {
  schemaVersion: "control-plane-live-infisical-backend-profile@1";
  siteUrl: string;
  clientId: string;
  clientSecret: string;
  projectId: string;
  environment: string;
  secretPath: string;
  deploymentIdentityEvidenceRef: string;
  leastPrivilegeScopeEvidenceRef: string;
  leastPrivilegeScope: InfisicalLeastPrivilegeScope;
};

export async function readLiveInfisicalBackendProfile(
  file: string,
): Promise<LiveInfisicalBackendProfile> {
  const profile = JSON.parse(await fsp.readFile(file, "utf8"));
  const errors = validateLiveInfisicalBackendProfile(profile);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return profile;
}

export function validateLiveInfisicalBackendProfile(profile: any): string[] {
  const errors: string[] = [];
  if (profile?.schemaVersion !== "control-plane-live-infisical-backend-profile@1") {
    errors.push("live Infisical backend profile schema invalid");
  }
  for (const field of [
    "siteUrl",
    "clientId",
    "clientSecret",
    "projectId",
    "environment",
    "secretPath",
    "deploymentIdentityEvidenceRef",
    "leastPrivilegeScopeEvidenceRef",
  ]) {
    if (typeof profile?.[field] !== "string" || !profile[field].trim()) {
      errors.push(`live Infisical backend profile ${field} is required`);
    }
  }
  if (profile?.secretPath && !String(profile.secretPath).startsWith("/")) {
    errors.push("live Infisical backend profile secretPath must be absolute");
  }
  if (!evidenceRef(profile?.deploymentIdentityEvidenceRef)) {
    errors.push("live Infisical backend profile deployment identity evidence is required");
  }
  if (!evidenceRef(profile?.leastPrivilegeScopeEvidenceRef)) {
    errors.push("live Infisical backend profile least-privilege evidence is required");
  }
  errors.push(...validateLeastPrivilegeScope(profile));
  return errors;
}

export function validateLeastPrivilegeScope(profile: any): string[] {
  const scope = profile?.leastPrivilegeScope;
  const errors: string[] = [];
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return ["live Infisical backend profile least-privilege scope payload is required"];
  }
  for (const field of ["projectId", "environment", "secretPath"]) {
    if (scope[field] !== profile?.[field]) {
      errors.push(`live Infisical backend profile least-privilege ${field} mismatch`);
    }
  }
  if (!Array.isArray(scope.allowedSecretNames) || scope.allowedSecretNames.length !== 1) {
    errors.push("live Infisical backend profile least-privilege names must be exact");
  }
  if (scope.secretPath === "/" || scope.allowedSecretNames?.includes("*")) {
    errors.push("live Infisical backend profile least-privilege scope is over-broad");
  }
  const permissions = Array.isArray(scope.permissions) ? scope.permissions.map(String).sort() : [];
  if (JSON.stringify(permissions) !== JSON.stringify(["create", "read", "update"])) {
    errors.push("live Infisical backend profile least-privilege permissions are invalid");
  }
  return errors;
}

export function profileCredential(profile: LiveInfisicalBackendProfile): InfisicalCredentialConfig {
  return {
    kind: "universal_auth",
    siteUrl: profile.siteUrl,
    clientId: profile.clientId,
    clientSecret: profile.clientSecret,
  };
}

function evidenceRef(value: unknown): boolean {
  return typeof value === "string" && /^evidence:\/\//.test(value);
}
