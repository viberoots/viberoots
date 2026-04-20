#!/usr/bin/env zx-wrapper
import {
  VAULT_ADDR_ENV,
  VAULT_AUTH_METHOD_ENV,
  VAULT_JWT_ENV,
  VAULT_JWT_FILE_ENV,
  VAULT_JWT_ROLE_ENV,
  VAULT_TOKEN_ENV,
} from "./deployment-secret-vault-credentials.ts";
import {
  DEFAULT_DEPLOYMENT_CLIENT_SECRET_ENV,
  DEPLOYMENT_CLIENT_SECRET_ENV_ENV,
} from "./deployment-vault-runtime.ts";

const SECRET_ENV_NAMES = new Set([
  VAULT_ADDR_ENV,
  VAULT_AUTH_METHOD_ENV,
  VAULT_JWT_ENV,
  VAULT_JWT_FILE_ENV,
  VAULT_JWT_ROLE_ENV,
  VAULT_TOKEN_ENV,
  DEFAULT_DEPLOYMENT_CLIENT_SECRET_ENV,
  DEPLOYMENT_CLIENT_SECRET_ENV_ENV,
  "CLOUDFLARE_API_TOKEN",
]);

function isSecretName(name: string): boolean {
  return (
    SECRET_ENV_NAMES.has(name) ||
    /^BNX_VAULT/.test(name) ||
    /^BNX_DEPLOYER_.*SECRET/.test(name) ||
    /^BNX_DEPLOYMENT_CLIENT_SECRET/.test(name) ||
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
