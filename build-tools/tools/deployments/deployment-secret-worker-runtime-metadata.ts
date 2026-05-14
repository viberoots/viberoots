#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { workerInfisicalRuntimeMetadata } from "./deployment-secret-infisical-runtime-worker";
import { workerVaultRuntimeMetadata } from "./deployment-vault-runtime-worker";

export function workerSecretRuntimeMetadata(opts: { deployment: DeploymentTarget }) {
  const vaultRuntime = workerVaultRuntimeMetadata(opts);
  const infisicalRuntime = workerInfisicalRuntimeMetadata(opts);
  return {
    ...(vaultRuntime ? { vaultRuntime } : {}),
    ...(infisicalRuntime ? { infisicalRuntime } : {}),
  };
}
