#!/usr/bin/env zx-wrapper
import {
  normalizeDeploymentPkceCallbackProfile,
  urlHost,
} from "./deployment-pkce-callback-profile";
import type { DeploymentAuthLoginRequest } from "./deployment-auth-session-types";
import type { DeploymentAuthProviderConfig } from "./deployment-auth-provider-config";

export function authBlockingMissing(missing: string[]): string[] {
  return missing.filter(
    (entry) =>
      entry.includes("Vault JWT auth") || entry.includes("lane governance repository metadata"),
  );
}

export function publicRedirectUri(
  input: DeploymentAuthLoginRequest,
  authProvider?: DeploymentAuthProviderConfig,
): string {
  const profile = normalizeDeploymentPkceCallbackProfile(
    input.deployment.vaultRuntime?.pkceCallback || {
      mode: "public_host",
      externalScheme: "https",
      externalHost: authProvider?.callback.externalHost || "deploy-auth.apps.kilty.io",
      externalPath: authProvider?.callback.externalPath || "/oidc/callback",
      bindHost: "127.0.0.1",
      bindPort: 7780,
      bindPath: authProvider?.callback.externalPath || "/oidc/callback",
    },
  );
  const port = profile.externalPort ? `:${profile.externalPort}` : "";
  return `${profile.externalScheme}://${urlHost(profile.externalHost)}${port}${profile.externalPath}`;
}
