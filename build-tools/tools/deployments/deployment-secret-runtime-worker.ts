#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { deploymentSecretFixturePath } from "./deployment-secret-fixture";
import { localFixtureServiceEnabled } from "./deployment-service-transport-policy";
import {
  activateDeploymentSecretContext,
  type DeploymentSecretContext,
} from "./deployment-secret-context";
import { resolveInfisicalCredentialFromRuntime } from "./deployment-secret-infisical-runtime-credentials";
import {
  cleanupDeploymentVaultRuntime,
  type PreparedDeploymentVaultRuntime,
} from "./deployment-vault-runtime";
import {
  prepareWorkerDeploymentVaultRuntime,
  withWorkerDeploymentVaultRuntime,
} from "./deployment-vault-runtime-worker";
import type { ControlPlaneCredentialDirectory } from "./control-plane-credentials";
import type { DeploymentInfisicalRuntimeConfig } from "./deployment-secret-metadata";

export type PreparedWorkerDeploymentSecretRuntime = {
  minted: boolean;
  secretContext?: DeploymentSecretContext;
};

function assertNoWorkerFixtureRuntime(env: NodeJS.ProcessEnv) {
  if (!deploymentSecretFixturePath()) return;
  if (localFixtureServiceEnabled(env)) return;
  throw new Error(
    "server-mode worker secret access must not use VBR_DEPLOYMENT_SECRET_FIXTURE_PATH",
  );
}

function clearInfisicalSecretContext(context: DeploymentSecretContext | undefined) {
  if (context?.kind !== "infisical") return;
  if (context.credential.kind === "universal_auth") context.credential.clientSecret = "";
  if (context.credential.kind === "access_token") context.credential.accessToken = "";
}

async function infisicalCredentialEnvFromDirectory(opts: {
  deployment: DeploymentTarget;
  runtime: DeploymentInfisicalRuntimeConfig;
  credentialDirectory: ControlPlaneCredentialDirectory;
}): Promise<NodeJS.ProcessEnv> {
  const clientIdEnv = opts.runtime.machineIdentityClientIdEnv;
  const clientSecretEnv = opts.runtime.machineIdentityClientSecretEnv;
  if (!clientIdEnv || !clientSecretEnv) {
    throw new Error("Infisical machine identity env names are required for credential files");
  }
  const files = opts.credentialDirectory.resolveInfisicalCredentialFiles({
    deploymentId: opts.deployment.deploymentId,
    siteUrl: opts.runtime.siteUrl,
    projectId: opts.runtime.projectId,
    environment: opts.runtime.environment,
    ...(opts.runtime.machineIdentityClientIdFileName
      ? { clientIdFileName: opts.runtime.machineIdentityClientIdFileName }
      : {}),
    ...(opts.runtime.machineIdentityClientSecretFileName
      ? { clientSecretFileName: opts.runtime.machineIdentityClientSecretFileName }
      : {}),
  });
  return {
    [clientIdEnv]: await opts.credentialDirectory.readCredentialFile(files.clientIdFile),
    [clientSecretEnv]: await opts.credentialDirectory.readCredentialFile(files.clientSecretFile),
  };
}

export async function prepareWorkerDeploymentSecretRuntime(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  env?: NodeJS.ProcessEnv;
  credentialDirectory?: ControlPlaneCredentialDirectory;
  timeoutMs?: number;
}): Promise<PreparedWorkerDeploymentSecretRuntime> {
  const backend = opts.deployment.secretBackend || "vault";
  if (backend === "vault") return await prepareWorkerDeploymentVaultRuntime(opts);
  if (opts.deployment.secretRequirements.length === 0) return { minted: false };
  const env = opts.env || process.env;
  assertNoWorkerFixtureRuntime(env);
  if (deploymentSecretFixturePath()) return { minted: false };
  if (!opts.deployment.infisicalRuntime) {
    throw new Error("Infisical-backed worker secret access requires infisical_runtime metadata");
  }
  const credentialEnv = opts.credentialDirectory
    ? await infisicalCredentialEnvFromDirectory({
        deployment: opts.deployment,
        runtime: opts.deployment.infisicalRuntime,
        credentialDirectory: opts.credentialDirectory,
      })
    : env;
  return {
    minted: true,
    secretContext: {
      kind: "infisical",
      credential: await resolveInfisicalCredentialFromRuntime({
        runtime: opts.deployment.infisicalRuntime,
        env: credentialEnv,
      }),
    },
  };
}

export async function cleanupWorkerDeploymentSecretRuntime(
  runtime: PreparedWorkerDeploymentSecretRuntime,
) {
  if (runtime.secretContext?.kind === "vault") {
    await cleanupDeploymentVaultRuntime(runtime as PreparedDeploymentVaultRuntime);
    return;
  }
  clearInfisicalSecretContext(runtime.secretContext);
  runtime.secretContext = undefined;
}

export async function withWorkerDeploymentSecretRuntime<T>(
  opts: {
    workspaceRoot: string;
    deployment: DeploymentTarget;
    env?: NodeJS.ProcessEnv;
    credentialDirectory?: ControlPlaneCredentialDirectory;
  },
  run: (runtime: PreparedWorkerDeploymentSecretRuntime) => Promise<T>,
): Promise<T> {
  if ((opts.deployment.secretBackend || "vault") === "vault") {
    return await withWorkerDeploymentVaultRuntime(opts, run);
  }
  const runtime = await prepareWorkerDeploymentSecretRuntime(opts);
  const restoreSecretContext = activateDeploymentSecretContext(runtime.secretContext);
  try {
    return await run(runtime);
  } finally {
    restoreSecretContext();
    await cleanupWorkerDeploymentSecretRuntime(runtime);
  }
}
