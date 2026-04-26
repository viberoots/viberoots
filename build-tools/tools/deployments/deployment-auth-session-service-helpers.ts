#!/usr/bin/env zx-wrapper
import {
  normalizeDeploymentPkceCallbackProfile,
  urlHost,
} from "./deployment-pkce-callback-profile.ts";
import type { DeploymentAuthLoginRequest } from "./deployment-auth-session-types.ts";

export function authBlockingMissing(missing: string[]): string[] {
  return missing.filter(
    (entry) =>
      entry.includes("Vault JWT auth") || entry.includes("lane governance repository metadata"),
  );
}

export function publicRedirectUri(input: DeploymentAuthLoginRequest): string {
  const profile = normalizeDeploymentPkceCallbackProfile(
    input.deployment.vaultRuntime?.pkceCallback || {
      mode: "public_host",
      externalScheme: "https",
      externalHost: "deploy-auth.apps.kilty.io",
      externalPath: "/oidc/callback",
      bindHost: "127.0.0.1",
      bindPort: 7780,
      bindPath: "/oidc/callback",
    },
  );
  const port = profile.externalPort ? `:${profile.externalPort}` : "";
  return `${profile.externalScheme}://${urlHost(profile.externalHost)}${port}${profile.externalPath}`;
}
