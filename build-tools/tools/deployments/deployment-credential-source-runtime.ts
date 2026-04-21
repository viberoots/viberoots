#!/usr/bin/env zx-wrapper
import type { JwtClaims } from "./deploy-vault-jwt-claims.ts";
import { mintDeployVaultJwt } from "./deploy-vault-jwt.ts";
import { runDeviceLogin } from "./deployment-credential-source-device.ts";
import {
  validateOidcToken,
  type HumanClaimRequirement,
} from "./deployment-credential-source-oidc.ts";
import { runPkceLogin } from "./deployment-credential-source-pkce.ts";
import type { DeploymentCredentialSource } from "./deployment-credential-source-selection.ts";
import type { DeploymentPkceCallbackProfileInput } from "./deployment-pkce-callback-profile.ts";

export type CredentialSourceRuntimeOptions = {
  source: DeploymentCredentialSource;
  addr: string;
  roleName: string;
  issuerUrl: string;
  audience?: string | undefined;
  repository: string;
  deploymentEnvironment: string;
  humanClientId: string;
  serviceClientId: string;
  clientSecretEnv: string;
  externalOidcTokenEnv: string;
  humanClaim?: HumanClaimRequirement | undefined;
  env: NodeJS.ProcessEnv;
  openBrowser: boolean;
  pkceCallback?: DeploymentPkceCallbackProfileInput | undefined;
  prompt?: (message: string) => void;
  timeoutMs?: number | undefined;
};

export type CredentialSourceResult = {
  source: DeploymentCredentialSource;
  addr: string;
  roleName: string;
  workloadJwt: string;
  claims: JwtClaims;
};

function readEnv(env: NodeJS.ProcessEnv, name: string): string {
  return String(env[name] || "").trim();
}

function boundClaims(opts: CredentialSourceRuntimeOptions): Record<string, string> {
  return {
    deployment_environment: opts.deploymentEnvironment,
    repository: opts.repository,
  };
}

async function mintJenkinsClientSecret(opts: CredentialSourceRuntimeOptions) {
  const clientSecret = readEnv(opts.env, opts.clientSecretEnv);
  if (!clientSecret) {
    throw new Error(`Jenkins client-secret credential is unset: ${opts.clientSecretEnv}`);
  }
  const minted = await mintDeployVaultJwt({
    issuer: opts.issuerUrl,
    clientId: opts.serviceClientId,
    clientSecret,
    audience: opts.audience,
    boundClaims: boundClaims(opts),
  });
  return { workloadJwt: minted.token, claims: minted.claims };
}

function readExternalOidcToken(opts: CredentialSourceRuntimeOptions) {
  const token = readEnv(opts.env, opts.externalOidcTokenEnv);
  if (!token)
    throw new Error(
      `external OIDC token environment variable is unset: ${opts.externalOidcTokenEnv}`,
    );
  return {
    workloadJwt: token,
    claims: validateOidcToken({
      token,
      issuer: opts.issuerUrl,
      audience: opts.audience,
      clientId: opts.serviceClientId,
      boundClaims: boundClaims(opts),
    }),
  };
}

async function readInteractiveToken(opts: CredentialSourceRuntimeOptions): Promise<string> {
  if (opts.source === "interactive_device") {
    return await runDeviceLogin({
      issuer: opts.issuerUrl,
      clientId: opts.humanClientId,
      audience: opts.audience,
      boundClaims: boundClaims(opts),
      humanClaim: opts.humanClaim,
      timeoutMs: opts.timeoutMs,
      prompt: opts.prompt,
    });
  }
  return await runPkceLogin({
    issuer: opts.issuerUrl,
    clientId: opts.humanClientId,
    audience: opts.audience,
    boundClaims: boundClaims(opts),
    humanClaim: opts.humanClaim,
    openBrowser: opts.openBrowser && opts.source === "interactive_pkce",
    callbackProfile: opts.pkceCallback,
    timeoutMs: opts.timeoutMs,
    prompt: opts.prompt,
  });
}

export async function resolveCredentialSourceVaultJwt(
  opts: CredentialSourceRuntimeOptions,
): Promise<CredentialSourceResult> {
  const result =
    opts.source === "jenkins_client_secret"
      ? await mintJenkinsClientSecret(opts)
      : opts.source === "jenkins_oidc" || opts.source === "external_oidc_token"
        ? readExternalOidcToken(opts)
        : {
            workloadJwt: await readInteractiveToken(opts),
            claims: {},
          };
  return {
    source: opts.source,
    addr: opts.addr,
    roleName: opts.roleName,
    workloadJwt: result.workloadJwt,
    claims: result.claims,
  };
}
