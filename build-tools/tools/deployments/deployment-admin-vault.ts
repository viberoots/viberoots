#!/usr/bin/env zx-wrapper
import { readFileSync } from "node:fs";
import { getFlagStr } from "../lib/cli";
import type { DeploymentTarget } from "./contract";
import {
  buildVaultBootstrapDocument,
  type VaultBootstrapInputs,
} from "./deployment-vault-bootstrap";
import {
  deploymentAdminVaultDrift,
  deploymentAdminVaultInSync,
  driftSummary,
  readDeploymentAdminVaultLiveState,
  writeDeploymentAdminVaultState,
  type VaultAdminCredential,
} from "./deployment-admin-vault-client";
import { VAULT_ADDR_ENV, VAULT_TOKEN_ENV } from "./deployment-secret-vault-credentials";
import { resolveDeploymentVaultRuntimePlan } from "./deployment-vault-runtime-plan";

export const DEPLOYMENT_ADMIN_VAULT_PLAN_SCHEMA = "deploy-admin-vault-plan@1";
export const DEPLOYMENT_ADMIN_VAULT_CHECK_SCHEMA = "deploy-admin-vault-check@1";
export const DEPLOYMENT_ADMIN_VAULT_SYNC_SCHEMA = "deploy-admin-vault-sync@1";

export type DeploymentAdminVaultDesiredState = {
  addr: string;
  issuerUrl: string;
  audience: string;
  roleName: string;
  policyName: string;
  policyHcl: string;
  boundClaims: Record<string, string>;
  role: {
    role_type: "jwt";
    user_claim: "sub";
    bound_audiences: string[];
    bound_claims: Record<string, string>;
    token_policies: string[];
  };
  config: {
    oidc_discovery_url: string;
    bound_issuer: string;
  };
};

function readEnv(env: NodeJS.ProcessEnv, name: string): string {
  return String(env[name] || "").trim();
}

function sortedObject(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function requireAdminToken(env: NodeJS.ProcessEnv): string {
  const tokenEnvName = getFlagStr("vault-admin-token-env", VAULT_TOKEN_ENV).trim();
  const tokenFromEnv = readEnv(env, tokenEnvName);
  if (tokenFromEnv) return tokenFromEnv;
  const tokenFile = getFlagStr("vault-admin-token-file", "").trim();
  if (tokenFile) {
    const tokenFromFile = readFileSync(tokenFile, "utf8").trim();
    if (tokenFromFile) return tokenFromFile;
    throw new Error(`Vault admin token file is empty: ${tokenFile}`);
  }
  throw new Error(`Vault admin token is unset: ${tokenEnvName}`);
}

function vaultAddr(desired: DeploymentAdminVaultDesiredState, env: NodeJS.ProcessEnv): string {
  return getFlagStr("vault-addr", "").trim() || readEnv(env, VAULT_ADDR_ENV) || desired.addr;
}

function desiredInputs(deployment: DeploymentTarget): VaultBootstrapInputs {
  const plan = resolveDeploymentVaultRuntimePlan({ deployment });
  return {
    issuerUrl: plan.issuerUrl,
    audience: plan.audience,
    deploymentClientId: plan.serviceClientId,
    roleName: plan.roleName,
    policyName: plan.roleName,
    extraBoundClaims: {
      deployment_environment: plan.deploymentEnvironment,
    },
  };
}

export function buildDeploymentAdminVaultDesiredState(
  deployment: DeploymentTarget,
): DeploymentAdminVaultDesiredState {
  const document = buildVaultBootstrapDocument({
    deployment,
    inputs: desiredInputs(deployment),
  });
  const boundClaims = sortedObject(document.vault.boundClaims);
  return {
    addr: document.runtimeEnvironment.VAULT_ADDR,
    issuerUrl: document.vault.issuerUrl,
    audience: document.vault.audience,
    roleName: document.vault.roleName,
    policyName: document.vault.policyName,
    policyHcl: document.policyHcl,
    boundClaims,
    config: {
      oidc_discovery_url: document.vault.issuerUrl,
      bound_issuer: document.vault.issuerUrl,
    },
    role: {
      role_type: "jwt",
      user_claim: "sub",
      bound_audiences: [document.vault.audience],
      bound_claims: boundClaims,
      token_policies: [document.vault.policyName],
    },
  };
}

export function buildDeploymentAdminVaultPlan(deployment: DeploymentTarget) {
  const desired = buildDeploymentAdminVaultDesiredState(deployment);
  return {
    schemaVersion: DEPLOYMENT_ADMIN_VAULT_PLAN_SCHEMA,
    deployment: {
      deploymentId: deployment.deploymentId,
      label: deployment.label,
      provider: deployment.provider,
      environmentStage: deployment.environmentStage,
      repository: deployment.lanePolicy.governance.repository,
    },
    readOnly: true,
    providerMutation: false,
    secretValuesRead: false,
    desired,
  };
}

function credentialForDesired(
  desired: DeploymentAdminVaultDesiredState,
  env: NodeJS.ProcessEnv,
): VaultAdminCredential {
  return {
    addr: vaultAddr(desired, env),
    token: requireAdminToken(env),
  };
}

export async function checkDeploymentAdminVault(opts: {
  deployment: DeploymentTarget;
  env?: NodeJS.ProcessEnv;
}) {
  const desired = buildDeploymentAdminVaultDesiredState(opts.deployment);
  const credential = credentialForDesired(desired, opts.env || process.env);
  const live = await readDeploymentAdminVaultLiveState(credential, desired);
  const drift = deploymentAdminVaultDrift(desired, live);
  return {
    schemaVersion: DEPLOYMENT_ADMIN_VAULT_CHECK_SCHEMA,
    deployment: buildDeploymentAdminVaultPlan(opts.deployment).deployment,
    readOnly: true,
    providerMutation: false,
    secretValuesRead: false,
    vaultAddr: credential.addr,
    inSync: deploymentAdminVaultInSync(drift),
    drift,
    driftSummary: driftSummary(drift),
    desired,
  };
}

export async function syncDeploymentAdminVault(opts: {
  deployment: DeploymentTarget;
  env?: NodeJS.ProcessEnv;
}) {
  const desired = buildDeploymentAdminVaultDesiredState(opts.deployment);
  const credential = credentialForDesired(desired, opts.env || process.env);
  const beforeLive = await readDeploymentAdminVaultLiveState(credential, desired);
  const beforeDrift = deploymentAdminVaultDrift(desired, beforeLive);
  if (!deploymentAdminVaultInSync(beforeDrift)) {
    await writeDeploymentAdminVaultState(credential, desired);
  }
  const afterLive = await readDeploymentAdminVaultLiveState(credential, desired);
  const afterDrift = deploymentAdminVaultDrift(desired, afterLive);
  return {
    schemaVersion: DEPLOYMENT_ADMIN_VAULT_SYNC_SCHEMA,
    deployment: buildDeploymentAdminVaultPlan(opts.deployment).deployment,
    readOnly: false,
    providerMutation: true,
    secretValuesRead: false,
    vaultAddr: credential.addr,
    changed: !deploymentAdminVaultInSync(beforeDrift),
    beforeDrift,
    beforeDriftSummary: driftSummary(beforeDrift),
    inSync: deploymentAdminVaultInSync(afterDrift),
    afterDrift,
    afterDriftSummary: driftSummary(afterDrift),
    desired,
  };
}
