#!/usr/bin/env zx-wrapper
import {
  VAULT_ADDR_ENV,
  VAULT_AUTH_METHOD_ENV,
  VAULT_JWT_ENV,
  VAULT_JWT_FILE_ENV,
  VAULT_JWT_ROLE_ENV,
  VAULT_TOKEN_ENV,
} from "./deployment-secret-vault-credentials";
import {
  DEFAULT_DEPLOYMENT_CLIENT_SECRET_ENV,
  DEFAULT_DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV,
  DEPLOYMENT_CLIENT_SECRET_ENV_ENV,
  DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV_ENV,
} from "./deployment-vault-runtime";

const SECRET_ENV_NAMES = new Set([
  "HELM_KUBEAPISERVER",
  "HELM_KUBEASGROUPS",
  "HELM_KUBEASUSER",
  "HELM_KUBECAFILE",
  "HELM_KUBECONTEXT",
  "HELM_KUBETOKEN",
  "KUBECONFIG",
  VAULT_ADDR_ENV,
  VAULT_AUTH_METHOD_ENV,
  VAULT_JWT_ENV,
  VAULT_JWT_FILE_ENV,
  VAULT_JWT_ROLE_ENV,
  VAULT_TOKEN_ENV,
  DEFAULT_DEPLOYMENT_CLIENT_SECRET_ENV,
  DEFAULT_DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV,
  DEPLOYMENT_CLIENT_SECRET_ENV_ENV,
  DEPLOYMENT_EXTERNAL_OIDC_TOKEN_ENV_ENV,
  "INFISICAL_TOKEN",
  "INFISICAL_ACCESS_TOKEN",
  "INFISICAL_PERSONAL_TOKEN",
  "INFISICAL_SERVICE_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL",
  "VBR_DEPLOY_CONTROL_PLANE_TOKEN",
]);

function isSecretName(name: string): boolean {
  return (
    SECRET_ENV_NAMES.has(name) ||
    /^VBR_VAULT/.test(name) ||
    /^VBR_DEPLOYER_.*SECRET/.test(name) ||
    /^VBR_DEPLOYMENT_CLIENT_SECRET/.test(name) ||
    /^VBR_DEPLOYMENT_.*TOKEN/.test(name) ||
    /^VBR_INFISICAL_.*(SECRET|TOKEN)/.test(name) ||
    /^JENKINS_.*(SECRET|TOKEN)/.test(name) ||
    /^DEPLOYMENT_CLIENT_SECRET$/.test(name)
  );
}

export function scrubDeploymentSecretEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (!isSecretName(name) && value !== undefined) scrubbed[name] = value;
  }
  return scrubbed;
}
