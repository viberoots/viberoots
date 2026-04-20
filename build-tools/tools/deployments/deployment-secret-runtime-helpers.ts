#!/usr/bin/env zx-wrapper
import { createDeploymentSecretRuntime } from "./deployment-secret-runtime.ts";
import { createDeploymentVaultSecretBackend } from "./deployment-secret-vault.ts";
import type { DeploymentSecretContext } from "./deployment-secret-context.ts";

export function createVaultDeploymentSecretRuntime(opts: {
  authority?: { kind?: string };
  admittedContext?: {
    admittedSecretReferences?: unknown[];
    secretRequirements?: unknown[];
    targetEnvironment?: { lockScope?: string };
  };
  fallbackTargetScope?: string;
  secretContext?: DeploymentSecretContext;
}) {
  return createDeploymentSecretRuntime({
    authority: opts.authority,
    backend: createDeploymentVaultSecretBackend(opts.secretContext),
    admittedReferences: (opts.admittedContext?.admittedSecretReferences || []) as any[],
    requirements: (opts.admittedContext?.secretRequirements || []) as any[],
    targetScope:
      opts.admittedContext?.targetEnvironment?.lockScope || opts.fallbackTargetScope || "unknown",
  });
}
