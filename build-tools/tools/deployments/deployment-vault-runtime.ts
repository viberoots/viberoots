#!/usr/bin/env zx-wrapper
import os from "node:os";
import { sanitizeName } from "../lib/sanitize.ts";
import type { DeploymentTarget } from "./contract.ts";
import { deploymentSecretFixturePath } from "./deployment-secret-fixture.ts";
import { VAULT_ADDR_ENV, VAULT_JWT_ROLE_ENV } from "./deployment-secret-vault-credentials.ts";
import type { DeploymentSecretContext } from "./deployment-secret-context.ts";
import { resolveCredentialSourceVaultJwt } from "./deployment-credential-source-runtime.ts";
import {
  isJenkinsSession,
  normalizeCredentialSource,
  selectDeploymentCredentialSource,
  type DeploymentCredentialSource,
} from "./deployment-credential-source-selection.ts";
import type { DeploymentVaultRuntimeInputs } from "./deployment-vault-runtime-inputs.ts";
export type { DeploymentVaultRuntimeInputs } from "./deployment-vault-runtime-inputs.ts";
export { readDeploymentVaultRuntimeInputsFromFlags } from "./deployment-vault-runtime-inputs.ts";

export const VAULT_OIDC_ISSUER_ENV = "BNX_VAULT_OIDC_ISSUER";
export const VAULT_AUDIENCE_ENV = "BNX_VAULT_AUDIENCE";
export const DEPLOYMENT_CLIENT_ID_ENV = "BNX_DEPLOYMENT_CLIENT_ID";
export const DEPLOYMENT_CLI_PUBLIC_CLIENT_ID_ENV = "BNX_DEPLOYMENT_CLI_PUBLIC_CLIENT_ID";
export const DEPLOYMENT_ENVIRONMENT_ENV = "BNX_DEPLOYMENT_ENVIRONMENT";
export const DEPLOYMENT_CLIENT_SECRET_ENV_ENV = "BNX_DEPLOYMENT_CLIENT_SECRET_ENV";
export const DEPLOYMENT_CREDENTIAL_SOURCE_ENV = "BNX_DEPLOYMENT_CREDENTIAL_SOURCE";
export const DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV_ENV = "BNX_DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV";
export const DEFAULT_DEPLOYMENT_CLIENT_ID = "deployment-runner";
export const DEFAULT_DEPLOYMENT_CLI_PUBLIC_CLIENT_ID = "deployment-cli";
export const DEFAULT_DEPLOYMENT_CLIENT_SECRET_ENV = "BNX_DEPLOYER_CLIENT_SECRET";
export const DEFAULT_DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV = "BNX_DEPLOYMENT_OIDC_TOKEN";
export const DEFAULT_VAULT_AUDIENCE = "deployments-vault";

function readEnv(env: NodeJS.ProcessEnv, name: string): string {
  return String(env[name] || "").trim();
}

function requireRepository(deployment: DeploymentTarget): string {
  const repository = deployment.lanePolicy.governance.repository.trim();
  if (!repository) {
    throw new Error("lane governance repository metadata is required for Vault runtime claims");
  }
  return repository;
}

export function defaultVaultJwtRoleName(deployment: DeploymentTarget): string {
  const stageSuffix = deployment.environmentStage ? `-${deployment.environmentStage}` : "";
  const base =
    stageSuffix && deployment.deploymentId.endsWith(stageSuffix)
      ? deployment.deploymentId.slice(0, -stageSuffix.length)
      : deployment.deploymentId;
  return `deploy-${sanitizeName(base)}-read`;
}

function inputOrEnv(
  input: string | undefined,
  env: NodeJS.ProcessEnv,
  envName: string,
  fallback = "",
): string {
  return (input?.trim() || readEnv(env, envName) || fallback).trim();
}

function runtimeValue(
  input: string | undefined,
  env: NodeJS.ProcessEnv,
  envName: string,
  metadata: string | undefined,
  fallback = "",
): string {
  return (input?.trim() || metadata?.trim() || readEnv(env, envName) || fallback).trim();
}

export type PreparedDeploymentVaultRuntime = {
  minted: boolean;
  roleName?: string;
  credentialSource?: DeploymentCredentialSource;
  secretContext?: DeploymentSecretContext;
};

export async function cleanupDeploymentVaultRuntime(runtime: PreparedDeploymentVaultRuntime) {
  const credential =
    runtime.secretContext?.kind === "vault" ? runtime.secretContext.credential : undefined;
  if (credential?.kind === "jwt") credential.workloadJwt = "";
  if (credential?.kind === "token") credential.token = "";
  runtime.secretContext = undefined;
}

export async function prepareDeploymentVaultRuntime(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  inputs?: DeploymentVaultRuntimeInputs | undefined;
  env?: NodeJS.ProcessEnv;
}): Promise<PreparedDeploymentVaultRuntime> {
  const env = opts.env || process.env;
  if (opts.deployment.secretRequirements.length === 0) return { minted: false };
  if (deploymentSecretFixturePath()) return { minted: false, secretContext: { kind: "fixture" } };

  const metadata = opts.deployment.vaultRuntime;
  const addr = runtimeValue(undefined, env, VAULT_ADDR_ENV, metadata?.addr);
  if (!addr) {
    throw new Error(
      `secret-consuming deployments require vault_runtime.addr, ${VAULT_ADDR_ENV}, or BNX_DEPLOYMENT_SECRET_FIXTURE_PATH`,
    );
  }

  const inputs = opts.inputs || {};
  const issuerUrl = runtimeValue(
    inputs.issuerUrl,
    env,
    VAULT_OIDC_ISSUER_ENV,
    metadata?.oidcIssuer,
  );
  if (!issuerUrl) {
    throw new Error(
      `deployment-derived Vault JWT auth requires vault_runtime.oidc_issuer, ${VAULT_OIDC_ISSUER_ENV}, or --vault-issuer-url`,
    );
  }

  const clientSecretEnv = inputOrEnv(
    inputs.clientSecretEnv,
    env,
    DEPLOYMENT_CLIENT_SECRET_ENV_ENV,
    metadata?.jenkinsClientSecretEnv ||
      metadata?.clientSecretEnv ||
      DEFAULT_DEPLOYMENT_CLIENT_SECRET_ENV,
  );

  const roleName = inputOrEnv(
    inputs.roleName,
    env,
    VAULT_JWT_ROLE_ENV,
    metadata?.roleName || defaultVaultJwtRoleName(opts.deployment),
  );
  const clientId = runtimeValue(
    inputs.deploymentClientId,
    env,
    DEPLOYMENT_CLIENT_ID_ENV,
    metadata?.serviceAccountClientId || metadata?.deploymentClientId,
    DEFAULT_DEPLOYMENT_CLIENT_ID,
  );
  const humanClientId = runtimeValue(
    inputs.cliPublicClientId,
    env,
    DEPLOYMENT_CLI_PUBLIC_CLIENT_ID_ENV,
    metadata?.cliPublicClientId || metadata?.deploymentClientId,
    DEFAULT_DEPLOYMENT_CLI_PUBLIC_CLIENT_ID,
  );
  const audience = runtimeValue(
    inputs.audience,
    env,
    VAULT_AUDIENCE_ENV,
    metadata?.audience,
    DEFAULT_VAULT_AUDIENCE,
  );
  const deploymentEnvironment = runtimeValue(
    inputs.deploymentEnvironment,
    env,
    DEPLOYMENT_ENVIRONMENT_ENV,
    metadata?.deploymentEnvironment,
    os.hostname() || opts.deployment.environmentStage,
  );
  const externalOidcTokenEnv = inputOrEnv(
    inputs.externalOidcTokenEnv,
    env,
    DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV_ENV,
    metadata?.externalOidcTokenEnv || DEFAULT_DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV,
  );
  const preferredSource =
    inputs.credentialSource ||
    normalizeCredentialSource(readEnv(env, DEPLOYMENT_CREDENTIAL_SOURCE_ENV)) ||
    metadata?.preferredCredentialSource ||
    (isJenkinsSession(env) || readEnv(env, clientSecretEnv) ? "jenkins_client_secret" : undefined);
  const selection = selectDeploymentCredentialSource({
    preferred: preferredSource,
    loginBrowser: inputs.loginBrowser,
    env,
  });

  const credential = await resolveCredentialSourceVaultJwt({
    source: selection.source,
    addr,
    roleName,
    issuerUrl,
    serviceClientId: clientId,
    humanClientId,
    clientSecretEnv,
    externalOidcTokenEnv,
    audience,
    deploymentEnvironment,
    repository: requireRepository(opts.deployment),
    humanClaim: metadata?.requiredHumanClaim
      ? {
          name: metadata.requiredHumanClaim,
          value: metadata.requiredHumanClaimValue,
        }
      : undefined,
    env,
    openBrowser: selection.source === "interactive_pkce",
    timeoutMs: inputs.timeoutMs,
    prompt: (message) => console.error(message),
  });

  return {
    minted: true,
    roleName,
    credentialSource: credential.source,
    secretContext: {
      kind: "vault",
      credential: {
        kind: "jwt",
        addr: credential.addr,
        role: credential.roleName,
        workloadJwt: credential.workloadJwt,
      },
    },
  };
}
