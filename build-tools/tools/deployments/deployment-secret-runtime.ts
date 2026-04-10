#!/usr/bin/env zx-wrapper
import type { NixosSharedHostMutationAuthority } from "./nixos-shared-host-control-plane-contract.ts";
import {
  deploymentSecretBindingsForStep,
  deploymentSecretContractBindings,
  type DeploymentSecretContractBinding,
} from "./deployment-secretspec.ts";
import type {
  DeploymentRequirement,
  DeploymentRequirementStep,
} from "./deployment-requirements.ts";

export type DeploymentSecretMaterial = {
  binding: DeploymentSecretContractBinding;
  value: string;
  allowedSteps: DeploymentRequirementStep[];
  targetScopes: string[];
  credentialClass: "routine" | "break_glass";
  refreshMode: "renew" | "reacquire" | "none";
  leaseId?: string;
  expiresAt?: string;
};

export type DeploymentSecretBackend = {
  acquire(binding: DeploymentSecretContractBinding): Promise<DeploymentSecretMaterial>;
  renew?(secret: DeploymentSecretMaterial): Promise<DeploymentSecretMaterial | undefined>;
};

type DeploymentSecretRuntimeOpts = {
  authority?: NixosSharedHostMutationAuthority | { kind?: string };
  backend: DeploymentSecretBackend;
  requirements: DeploymentRequirement[];
  targetScope: string;
  now?: () => Date;
};

function authorityMode(authority?: DeploymentSecretRuntimeOpts["authority"]) {
  return authority?.kind === "break-glass-worker" ? "break_glass" : "routine";
}

function isExpired(secret: DeploymentSecretMaterial, now: Date): boolean {
  return !!secret.expiresAt && Date.parse(secret.expiresAt) <= now.getTime();
}

function ensureAccess(
  secret: DeploymentSecretMaterial,
  step: DeploymentRequirementStep,
  targetScope: string,
  mode: "routine" | "break_glass",
) {
  if (!secret.allowedSteps.includes(step)) {
    throw new Error(
      `secret contract ${secret.binding.contractId} is not authorized for lifecycle step ${step}`,
    );
  }
  if (!secret.targetScopes.includes("*") && !secret.targetScopes.includes(targetScope)) {
    throw new Error(
      `secret contract ${secret.binding.contractId} is not authorized for target scope ${targetScope}`,
    );
  }
  if (secret.credentialClass === "break_glass" && mode !== "break_glass") {
    throw new Error(
      `secret contract ${secret.binding.contractId} is restricted to the audited break-glass path`,
    );
  }
}

async function refreshSecret(
  backend: DeploymentSecretBackend,
  current: DeploymentSecretMaterial,
): Promise<DeploymentSecretMaterial | undefined> {
  if (current.refreshMode === "renew" && backend.renew) return await backend.renew(current);
  if (current.refreshMode === "reacquire") return await backend.acquire(current.binding);
  return undefined;
}

export function createDeploymentSecretRuntime(opts: DeploymentSecretRuntimeOpts) {
  const bindings = deploymentSecretContractBindings(opts.requirements);
  const cached = new Map<string, DeploymentSecretMaterial>();
  const now = opts.now || (() => new Date());
  const mode = authorityMode(opts.authority);

  return {
    async enterStep(step: DeploymentRequirementStep): Promise<Record<string, string>> {
      const active = deploymentSecretBindingsForStep(bindings, step);
      const resolved: Record<string, string> = {};
      for (const binding of active) {
        let secret = cached.get(binding.referenceId);
        try {
          if (!secret) {
            secret = await opts.backend.acquire(binding);
          } else if (isExpired(secret, now())) {
            secret = await refreshSecret(opts.backend, secret);
          }
        } catch (error) {
          if (!binding.required) continue;
          throw error;
        }
        if (!secret) {
          if (!binding.required) continue;
          throw new Error(
            `required secret contract ${binding.contractId} expired, was revoked, or cannot be refreshed for ${step}`,
          );
        }
        if (isExpired(secret, now())) {
          if (!binding.required) continue;
          throw new Error(
            `required secret contract ${binding.contractId} expired, was revoked, or cannot be refreshed for ${step}`,
          );
        }
        ensureAccess(secret, step, opts.targetScope, mode);
        cached.set(binding.referenceId, secret);
        resolved[binding.name] = secret.value;
      }
      return resolved;
    },
  };
}
