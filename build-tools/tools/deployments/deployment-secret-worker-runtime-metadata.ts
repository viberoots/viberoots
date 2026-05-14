#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { workerInfisicalRuntimeMetadata } from "./deployment-secret-infisical-runtime-worker";
import { workerVaultRuntimeMetadata } from "./deployment-vault-runtime-worker";

export function workerSecretRuntimeMetadata(opts: { deployment: DeploymentTarget }) {
  const backend = opts.deployment.secretBackend || "vault";
  const vaultRuntime = backend === "vault" ? workerVaultRuntimeMetadata(opts) : undefined;
  const infisicalRuntime =
    backend === "infisical" ? workerInfisicalRuntimeMetadata(opts) : undefined;
  return {
    ...(vaultRuntime ? { vaultRuntime } : {}),
    ...(infisicalRuntime ? { infisicalRuntime } : {}),
  };
}
