#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { withWorkerDeploymentSecretRuntime } from "./deployment-secret-runtime-worker";

export async function withFrozenProviderWorkerSecretRuntime<T>(
  opts: {
    workspaceRoot: string;
    deployment: DeploymentTarget;
  },
  run: () => Promise<T>,
): Promise<T> {
  if ((opts.deployment.secretBackend || "vault") !== "infisical") return await run();
  if (opts.deployment.secretRequirements.length === 0) return await run();
  return await withWorkerDeploymentSecretRuntime(opts, async () => await run());
}
