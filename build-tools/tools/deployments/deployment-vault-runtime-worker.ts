#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import { deploymentSecretFixturePath } from "./deployment-secret-fixture.ts";
import { activateDeploymentSecretContext } from "./deployment-secret-context.ts";
import {
  cleanupDeploymentVaultRuntime,
  prepareDeploymentVaultRuntime,
  type PreparedDeploymentVaultRuntime,
} from "./deployment-vault-runtime.ts";
import { resolveDeploymentVaultRuntimePlan } from "./deployment-vault-runtime-plan.ts";

export type DeploymentWorkerVaultRuntimeMetadata = {
  addr: string;
  oidcIssuer: string;
  audience: string;
  serviceAccountClientId: string;
  roleName: string;
  deploymentEnvironment: string;
  repository: string;
  credentialSource?: string;
  clientSecretEnv?: string;
  externalOidcTokenEnv?: string;
};

function serverModeCredentialError(source: string): Error {
  return new Error(
    `server-mode worker Vault access requires a server-local credential source, not ${source}`,
  );
}

function assertWorkerCredentialSource(source: string | undefined) {
  if (!source) throw new Error("deployment credential source selection failed");
  if (source.startsWith("interactive")) {
    throw serverModeCredentialError(source);
  }
}

function assertNoFixtureRuntime() {
  if (!deploymentSecretFixturePath()) return;
  throw new Error(
    "server-mode worker Vault access must not use BNX_DEPLOYMENT_SECRET_FIXTURE_PATH",
  );
}

export function workerVaultRuntimeMetadata(opts: {
  deployment: DeploymentTarget;
  env?: NodeJS.ProcessEnv;
}): DeploymentWorkerVaultRuntimeMetadata | undefined {
  const plan = resolveDeploymentVaultRuntimePlan({
    deployment: opts.deployment,
    env: opts.env || process.env,
  });
  if (!plan.requiresSecrets) return undefined;
  return {
    addr: plan.addr,
    oidcIssuer: plan.issuerUrl,
    audience: plan.audience,
    serviceAccountClientId: plan.serviceClientId,
    roleName: plan.roleName,
    deploymentEnvironment: plan.deploymentEnvironment,
    repository: plan.repository,
    ...(plan.selection ? { credentialSource: plan.selection.source } : {}),
    ...(plan.clientSecretEnv ? { clientSecretEnv: plan.clientSecretEnv } : {}),
    ...(plan.externalOidcTokenEnv ? { externalOidcTokenEnv: plan.externalOidcTokenEnv } : {}),
  };
}

export async function prepareWorkerDeploymentVaultRuntime(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  env?: NodeJS.ProcessEnv;
}): Promise<PreparedDeploymentVaultRuntime> {
  const env = opts.env || process.env;
  const plan = resolveDeploymentVaultRuntimePlan({ deployment: opts.deployment, env });
  if (!plan.requiresSecrets) return { minted: false };
  assertNoFixtureRuntime();
  if (plan.missing.length > 0) throw new Error(plan.missing[0]);
  if (plan.selectionError) throw new Error(plan.selectionError);
  assertWorkerCredentialSource(plan.selection?.source);
  if (plan.credentialInputMissing.length > 0) {
    throw new Error(plan.credentialInputMissing[0]);
  }
  return await prepareDeploymentVaultRuntime({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    env,
  });
}

export async function withWorkerDeploymentVaultRuntime<T>(
  opts: {
    workspaceRoot: string;
    deployment: DeploymentTarget;
    env?: NodeJS.ProcessEnv;
  },
  run: (runtime: PreparedDeploymentVaultRuntime) => Promise<T>,
): Promise<T> {
  const runtime = await prepareWorkerDeploymentVaultRuntime(opts);
  const restoreSecretContext = activateDeploymentSecretContext(runtime.secretContext);
  try {
    return await run(runtime);
  } finally {
    restoreSecretContext();
    await cleanupDeploymentVaultRuntime(runtime);
  }
}
