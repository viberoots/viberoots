#!/usr/bin/env zx-wrapper
import { validateBasePath } from "./control-plane-runtime-config-paths";

export type DeploymentAuthProviderKind = "local-oidc" | "generic-oidc-jwks";
export type DeploymentAuthCliLoginMode = "pkce-public-callback" | "device-code" | "external-url";

export type DeploymentAuthClaimMapping = {
  userIdClaim: string;
  emailClaim: string;
  roleClaim: string;
  servicePrincipalClaim: string;
};

export type DeploymentAuthProviderConfig = {
  kind: DeploymentAuthProviderKind;
  issuer: string;
  audience: string[];
  jwksUrl?: string;
  tokenSupport: "jwt";
  claims: DeploymentAuthClaimMapping;
  cliLoginMode: DeploymentAuthCliLoginMode;
  callback: {
    externalHost: string;
    externalPath: string;
  };
  roleGroups: {
    deployer: string[];
    admissionReporter: string[];
    admin: string[];
  };
  servicePrincipals: Record<string, string>;
};

const DEFAULT_CLAIMS: DeploymentAuthClaimMapping = {
  userIdClaim: "sub",
  emailClaim: "email",
  roleClaim: "groups",
  servicePrincipalClaim: "azp",
};

export function normalizeAuthProviderConfig(value: unknown): DeploymentAuthProviderConfig {
  if (value === undefined) return localAuthProviderDefaults();
  const input = objectValue(value, "authProvider");
  const kind = enumValue(
    input.kind ?? "generic-oidc-jwks",
    ["local-oidc", "generic-oidc-jwks"],
    "authProvider.kind",
  );
  const claims = objectValue(input.claims ?? {}, "authProvider.claims");
  return {
    kind,
    issuer: stringValue(input.issuer, "authProvider.issuer").replace(/\/+$/, ""),
    audience: stringList(input.audience, "authProvider.audience"),
    ...(optionalString(input.jwksUrl, "authProvider.jwksUrl")
      ? {
          jwksUrl: optionalString(input.jwksUrl, "authProvider.jwksUrl"),
        }
      : {}),
    tokenSupport: enumValue(input.tokenSupport ?? "jwt", ["jwt"], "authProvider.tokenSupport"),
    claims: {
      userIdClaim: stringValue(
        claims.userIdClaim ?? DEFAULT_CLAIMS.userIdClaim,
        "authProvider.claims.userIdClaim",
      ),
      emailClaim: stringValue(
        claims.emailClaim ?? DEFAULT_CLAIMS.emailClaim,
        "authProvider.claims.emailClaim",
      ),
      roleClaim: stringValue(
        claims.roleClaim ?? DEFAULT_CLAIMS.roleClaim,
        "authProvider.claims.roleClaim",
      ),
      servicePrincipalClaim: stringValue(
        claims.servicePrincipalClaim ?? DEFAULT_CLAIMS.servicePrincipalClaim,
        "authProvider.claims.servicePrincipalClaim",
      ),
    },
    cliLoginMode: enumValue(
      input.cliLoginMode ?? "pkce-public-callback",
      ["pkce-public-callback", "device-code", "external-url"],
      "authProvider.cliLoginMode",
    ),
    callback: normalizeCallback(input.callback),
    roleGroups: normalizeRoleGroups(input.roleGroups),
    servicePrincipals: stringRecord(
      input.servicePrincipals ?? {},
      "authProvider.servicePrincipals",
    ),
  };
}

function localAuthProviderDefaults(): DeploymentAuthProviderConfig {
  return {
    kind: "local-oidc",
    issuer: "local-deployment-identity-provider",
    audience: ["deployments-vault"],
    tokenSupport: "jwt",
    claims: DEFAULT_CLAIMS,
    cliLoginMode: "pkce-public-callback",
    callback: { externalHost: "deploy-auth.apps.kilty.io", externalPath: "/oidc/callback" },
    roleGroups: { deployer: [], admissionReporter: [], admin: [] },
    servicePrincipals: {},
  };
}

function normalizeCallback(value: unknown): DeploymentAuthProviderConfig["callback"] {
  const callback = objectValue(value ?? {}, "authProvider.callback");
  return {
    externalHost: stringValue(
      callback.externalHost ?? "deploy-auth.apps.kilty.io",
      "authProvider.callback.externalHost",
    ),
    externalPath: validateBasePath(
      stringValue(callback.externalPath ?? "/oidc/callback", "authProvider.callback.externalPath"),
      "authProvider.callback.externalPath",
    ),
  };
}

function normalizeRoleGroups(value: unknown): DeploymentAuthProviderConfig["roleGroups"] {
  const groups = objectValue(value ?? {}, "authProvider.roleGroups");
  return {
    deployer: stringList(groups.deployer ?? [], "authProvider.roleGroups.deployer"),
    admissionReporter: stringList(
      groups.admissionReporter ?? [],
      "authProvider.roleGroups.admissionReporter",
    ),
    admin: stringList(groups.admin ?? [], "authProvider.roleGroups.admin"),
  };
}

function objectValue(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${fieldName} must be an object`);
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(value, fieldName);
}

function stringValue(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${fieldName} must be a non-empty string`);
  return value.trim();
}

function stringList(value: unknown, fieldName: string): string[] {
  if (typeof value === "string") return [stringValue(value, fieldName)];
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be a string list`);
  return value.map((entry, index) => stringValue(entry, `${fieldName}[${index}]`));
}

function stringRecord(value: unknown, fieldName: string): Record<string, string> {
  const object = objectValue(value, fieldName);
  return Object.fromEntries(
    Object.entries(object).map(([key, entry]) => [key, stringValue(entry, `${fieldName}.${key}`)]),
  );
}

function enumValue<T extends string>(value: unknown, choices: T[], fieldName: string): T {
  if (typeof value !== "string" || !choices.includes(value as T))
    throw new Error(`${fieldName} has unsupported value`);
  return value as T;
}
