#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { deploymentSecretFixturePath } from "./deployment-secret-fixture";
import type { DeploymentSecretContext } from "./deployment-secret-context";
import { resolveInfisicalCredentialFromRuntime } from "./deployment-secret-infisical-runtime-credentials";
import {
  cleanupDeploymentVaultRuntime,
  prepareDeploymentVaultRuntime,
  type DeploymentVaultRuntimeInputs,
  type PreparedDeploymentVaultRuntime,
} from "./deployment-vault-runtime";

export type PreparedDeploymentSecretRuntime = PreparedDeploymentVaultRuntime;

function clearInfisicalSecretContext(context: DeploymentSecretContext | undefined) {
  if (context?.kind !== "infisical") return;
  if (context.credential.kind === "universal_auth") context.credential.clientSecret = "";
  if (context.credential.kind === "access_token") context.credential.accessToken = "";
}

export async function cleanupDeploymentSecretRuntime(runtime: PreparedDeploymentSecretRuntime) {
  if (runtime.secretContext?.kind === "vault") {
    await cleanupDeploymentVaultRuntime(runtime);
    return;
  }
  clearInfisicalSecretContext(runtime.secretContext);
  runtime.secretContext = undefined;
}

export async function prepareDeploymentSecretRuntime(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  inputs?: DeploymentVaultRuntimeInputs | undefined;
  env?: NodeJS.ProcessEnv;
}): Promise<PreparedDeploymentSecretRuntime> {
  const backend = opts.deployment.secretBackend || "vault";
  if (backend === "vault") return await prepareDeploymentVaultRuntime(opts);
  if (opts.deployment.secretRequirements.length === 0) return { minted: false };
  if (deploymentSecretFixturePath()) return { minted: false, secretContext: { kind: "fixture" } };
  if (!opts.deployment.infisicalRuntime) {
    throw new Error(
      "Infisical-backed local direct secret access requires infisical_runtime metadata",
    );
  }
  return {
    minted: true,
    secretContext: {
      kind: "infisical",
      credential: await resolveInfisicalCredentialFromRuntime({
        runtime: opts.deployment.infisicalRuntime,
        env: opts.env || process.env,
      }),
    },
  };
}
