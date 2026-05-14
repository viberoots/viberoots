#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import type { DeploymentInfisicalRuntimeConfig } from "./deployment-secret-metadata";

export type DeploymentWorkerInfisicalRuntimeMetadata = DeploymentInfisicalRuntimeConfig;

export function workerInfisicalRuntimeMetadata(opts: {
  deployment: DeploymentTarget;
}): DeploymentWorkerInfisicalRuntimeMetadata | undefined {
  if (opts.deployment.secretBackend !== "infisical") return undefined;
  if (opts.deployment.secretRequirements.length === 0) return undefined;
  return opts.deployment.infisicalRuntime;
}
