#!/usr/bin/env zx-wrapper
import { createDeploymentSecretRuntime } from "./deployment-secret-runtime.ts";
import { createDeploymentVaultSecretBackend } from "./deployment-secret-vault.ts";

export function createVaultDeploymentSecretRuntime(opts: {
  authority?: { kind?: string };
  admittedContext?: {
    secretRequirements?: unknown[];
    targetEnvironment?: { lockScope?: string };
  };
  fallbackTargetScope?: string;
}) {
  return createDeploymentSecretRuntime({
    authority: opts.authority,
    backend: createDeploymentVaultSecretBackend(),
    requirements: (opts.admittedContext?.secretRequirements || []) as any[],
    targetScope:
      opts.admittedContext?.targetEnvironment?.lockScope || opts.fallbackTargetScope || "unknown",
  });
}
