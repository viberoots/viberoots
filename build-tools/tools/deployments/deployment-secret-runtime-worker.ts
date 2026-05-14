#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { deploymentSecretFixturePath } from "./deployment-secret-fixture";
import { localFixtureServiceEnabled } from "./deployment-service-transport-policy";
import {
  activateDeploymentSecretContext,
  type DeploymentSecretContext,
} from "./deployment-secret-context";
import { infisicalCredentialFromRuntime } from "./deployment-secret-infisical-credentials";
import {
  cleanupDeploymentVaultRuntime,
  type PreparedDeploymentVaultRuntime,
} from "./deployment-vault-runtime";
import {
  prepareWorkerDeploymentVaultRuntime,
  withWorkerDeploymentVaultRuntime,
} from "./deployment-vault-runtime-worker";

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

export async function prepareWorkerDeploymentSecretRuntime(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  env?: NodeJS.ProcessEnv;
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
  return {
    minted: true,
    secretContext: {
      kind: "infisical",
      credential: infisicalCredentialFromRuntime({
        runtime: opts.deployment.infisicalRuntime,
        env,
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
