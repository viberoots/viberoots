#!/usr/bin/env zx-wrapper
import { getFlagStr } from "../lib/cli.ts";
import {
  normalizeCredentialSource,
  normalizeLoginBrowserMode,
  type DeploymentCredentialSource,
  type LoginBrowserMode,
} from "./deployment-credential-source-selection.ts";
import type { DeploymentPkceCallbackProfileInput } from "./deployment-pkce-callback-profile.ts";

export type DeploymentVaultRuntimeInputs = {
  issuerUrl?: string | undefined;
  audience?: string | undefined;
  deploymentClientId?: string | undefined;
  cliPublicClientId?: string | undefined;
  deploymentEnvironment?: string | undefined;
  roleName?: string | undefined;
  clientSecretEnv?: string | undefined;
  credentialSource?: DeploymentCredentialSource | undefined;
  loginBrowser?: LoginBrowserMode | undefined;
  pkceCallback?: DeploymentPkceCallbackProfileInput | undefined;
  externalOidcTokenEnv?: string | undefined;
  timeoutMs?: number | undefined;
};

function getFlagPort(name: string): string | undefined {
  return getFlagStr(name, "").trim() || undefined;
}

export function readDeploymentVaultRuntimeInputsFromFlags(): DeploymentVaultRuntimeInputs {
  return {
    issuerUrl:
      getFlagStr("vault-issuer-url", "").trim() || getFlagStr("issuer-url", "").trim() || undefined,
    audience: getFlagStr("vault-audience", "").trim() || undefined,
    deploymentClientId: getFlagStr("deployment-client-id", "").trim() || undefined,
    cliPublicClientId: getFlagStr("cli-public-client-id", "").trim() || undefined,
    deploymentEnvironment: getFlagStr("deployment-environment", "").trim() || undefined,
    roleName: getFlagStr("vault-jwt-role", "").trim() || undefined,
    clientSecretEnv: getFlagStr("deployment-client-secret-env", "").trim() || undefined,
    credentialSource: normalizeCredentialSource(
      getFlagStr("credential-source", "").trim() || undefined,
    ),
    loginBrowser: normalizeLoginBrowserMode(getFlagStr("login-browser", "auto")),
    pkceCallback: {
      mode: getFlagPort("pkce-callback-mode"),
      externalScheme: getFlagPort("pkce-callback-external-scheme"),
      externalHost: getFlagPort("pkce-callback-host") || getFlagPort("login-callback-host"),
      externalPort: getFlagPort("pkce-callback-external-port") || getFlagPort("pkce-callback-port"),
      externalPath: getFlagPort("pkce-callback-external-path"),
      bindHost: getFlagPort("pkce-callback-bind-host") || getFlagPort("login-callback-bind-host"),
      bindPort: getFlagPort("pkce-callback-bind-port"),
      bindPath: getFlagPort("pkce-callback-bind-path"),
    },
    externalOidcTokenEnv: getFlagStr("external-oidc-token-env", "").trim() || undefined,
  };
}
