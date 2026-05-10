#!/usr/bin/env zx-wrapper
import os from "node:os";
import { sanitizeName } from "../lib/sanitize";
import type { DeploymentTarget } from "./contract";
import { deploymentSecretFixturePath } from "./deployment-secret-fixture";
import { VAULT_ADDR_ENV, VAULT_JWT_ROLE_ENV } from "./deployment-secret-vault-credentials";
import {
  isJenkinsSession,
  normalizeCredentialSource,
  selectDeploymentCredentialSource,
  type CredentialSourceSelection,
  type DeploymentCredentialSource,
} from "./deployment-credential-source-selection";
import type { DeploymentVaultRuntimeInputs } from "./deployment-vault-runtime-inputs";

export const VAULT_OIDC_ISSUER_ENV = "VBR_VAULT_OIDC_ISSUER";
export const VAULT_AUDIENCE_ENV = "VBR_VAULT_AUDIENCE";
export const DEPLOYMENT_CLIENT_ID_ENV = "VBR_DEPLOYMENT_CLIENT_ID";
export const DEPLOYMENT_CLI_PUBLIC_CLIENT_ID_ENV = "VBR_DEPLOYMENT_CLI_PUBLIC_CLIENT_ID";
export const DEPLOYMENT_ENVIRONMENT_ENV = "VBR_DEPLOYMENT_ENVIRONMENT";
export const DEPLOYMENT_CLIENT_SECRET_ENV_ENV = "VBR_DEPLOYMENT_CLIENT_SECRET_ENV";
export const DEPLOYMENT_CREDENTIAL_SOURCE_ENV = "VBR_DEPLOYMENT_CREDENTIAL_SOURCE";
export const DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV_ENV = "VBR_DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV";
export const DEFAULT_DEPLOYMENT_CLIENT_ID = "deployment-runner";
export const DEFAULT_DEPLOYMENT_CLI_PUBLIC_CLIENT_ID = "deployment-cli";
export const DEFAULT_DEPLOYMENT_CLIENT_SECRET_ENV = "VBR_DEPLOYER_CLIENT_SECRET";
export const DEFAULT_DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV = "VBR_DEPLOYMENT_OIDC_TOKEN";
export const DEFAULT_VAULT_AUDIENCE = "deployments-vault";

export type DeploymentVaultRuntimePlan = {
  requiresSecrets: boolean;
  fixtureActive: boolean;
  missing: string[];
  credentialInputMissing: string[];
  selectionError?: string;
  addr: string;
  issuerUrl: string;
  audience: string;
  roleName: string;
  clientSecretEnv: string;
  serviceClientId: string;
  humanClientId: string;
  deploymentEnvironment: string;
  externalOidcTokenEnv: string;
  repository: string;
  selection?: CredentialSourceSelection;
};

function readEnv(env: NodeJS.ProcessEnv, name: string): string {
  return String(env[name] || "").trim();
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

export function defaultVaultJwtRoleName(deployment: DeploymentTarget): string {
  const stageSuffix = deployment.environmentStage ? `-${deployment.environmentStage}` : "";
  const base =
    stageSuffix && deployment.deploymentId.endsWith(stageSuffix)
      ? deployment.deploymentId.slice(0, -stageSuffix.length)
      : deployment.deploymentId;
  return `deploy-${sanitizeName(base)}-read`;
}

function resolveRepository(deployment: DeploymentTarget): string {
  return deployment.lanePolicy.governance.repository.trim();
}

function maybeSelectCredentialSource(opts: {
  preferred?: DeploymentCredentialSource | undefined;
  inputs: DeploymentVaultRuntimeInputs;
  env: NodeJS.ProcessEnv;
}): { selection?: CredentialSourceSelection; selectionError?: string } {
  try {
    return {
      selection: selectDeploymentCredentialSource({
        preferred: opts.preferred,
        loginBrowser: opts.inputs.loginBrowser,
        env: opts.env,
      }),
    };
  } catch (error) {
    return { selectionError: String((error as Error)?.message || error) };
  }
}

function credentialInputMissing(
  selection: CredentialSourceSelection | undefined,
  env: NodeJS.ProcessEnv,
  clientSecretEnv: string,
  externalOidcTokenEnv: string,
): string[] {
  if (!selection) return [];
  if (selection.source === "jenkins_client_secret" && !readEnv(env, clientSecretEnv)) {
    return [`Jenkins client-secret credential is unset: ${clientSecretEnv}`];
  }
  if (
    (selection.source === "jenkins_oidc" || selection.source === "external_oidc_token") &&
    !readEnv(env, externalOidcTokenEnv)
  ) {
    return [`external OIDC token environment variable is unset: ${externalOidcTokenEnv}`];
  }
  return [];
}

export function resolveDeploymentVaultRuntimePlan(opts: {
  deployment: DeploymentTarget;
  inputs?: DeploymentVaultRuntimeInputs | undefined;
  env?: NodeJS.ProcessEnv;
}): DeploymentVaultRuntimePlan {
  const env = opts.env || process.env;
  const inputs = opts.inputs || {};
  const metadata = opts.deployment.vaultRuntime;
  const addr = runtimeValue(undefined, env, VAULT_ADDR_ENV, metadata?.addr);
  const issuerUrl = runtimeValue(
    inputs.issuerUrl,
    env,
    VAULT_OIDC_ISSUER_ENV,
    metadata?.oidcIssuer,
  );
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
  const serviceClientId = runtimeValue(
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
  const preferred =
    inputs.credentialSource ||
    normalizeCredentialSource(readEnv(env, DEPLOYMENT_CREDENTIAL_SOURCE_ENV)) ||
    metadata?.preferredCredentialSource ||
    (isJenkinsSession(env) || readEnv(env, clientSecretEnv) ? "jenkins_client_secret" : undefined);
  const { selection, selectionError } = maybeSelectCredentialSource({ preferred, inputs, env });
  const repository = resolveRepository(opts.deployment);
  const requiresSecrets = opts.deployment.secretRequirements.length > 0;
  const fixtureActive = !!deploymentSecretFixturePath();
  const missing = [
    ...(requiresSecrets && !fixtureActive && !addr
      ? [
          `secret-consuming deployments require vault_runtime.addr, ${VAULT_ADDR_ENV}, or VBR_DEPLOYMENT_SECRET_FIXTURE_PATH`,
        ]
      : []),
    ...(requiresSecrets && !fixtureActive && !issuerUrl
      ? [
          `deployment-derived Vault JWT auth requires vault_runtime.oidc_issuer, ${VAULT_OIDC_ISSUER_ENV}, or --vault-issuer-url`,
        ]
      : []),
    ...(requiresSecrets && !repository
      ? ["lane governance repository metadata is required for Vault runtime claims"]
      : []),
  ];
  return {
    requiresSecrets,
    fixtureActive,
    missing,
    credentialInputMissing: credentialInputMissing(
      selection,
      env,
      clientSecretEnv,
      externalOidcTokenEnv,
    ),
    ...(selectionError ? { selectionError } : {}),
    addr,
    issuerUrl,
    audience,
    roleName,
    clientSecretEnv,
    serviceClientId,
    humanClientId,
    deploymentEnvironment,
    externalOidcTokenEnv,
    repository,
    ...(selection ? { selection } : {}),
  };
}
