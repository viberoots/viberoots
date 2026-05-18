#!/usr/bin/env zx-wrapper
import type {
  DeploymentSecretBackend,
  DeploymentSecretMaterial,
} from "./deployment-secret-runtime";
import {
  deploymentSecretFixturePath,
  deploymentSecretFixtureSelector,
  deploymentSecretFixtureVersion,
  mergeDeploymentSecretFixtureEntry,
  readDeploymentSecretFixture,
  type DeploymentSecretFixture,
  type DeploymentSecretFixtureEntry,
} from "./deployment-secret-fixture";
import {
  acquireDirectVaultSecretReference,
  resolveDirectVaultSecretReference,
} from "./deployment-secret-vault-direct";
import {
  deploymentSecretContext,
  missingDeploymentSecretContextError,
  type DeploymentSecretContext,
} from "./deployment-secret-context";
import {
  deploymentSecretContractBindings,
  isDeploymentSecretAdmittedReference,
  type DeploymentSecretAdmittedReference,
  type DeploymentSecretContractBinding,
  type DeploymentSecretReference,
} from "./deployment-sprinkle-ref";
import type { DeploymentRequirement } from "./deployment-requirements";

function materialFromEntry(
  binding: DeploymentSecretReference,
  entry: DeploymentSecretFixtureEntry,
): DeploymentSecretMaterial {
  if (entry.revoked) {
    throw new Error(`required secret contract ${binding.contractId} is revoked`);
  }
  return {
    binding,
    value: entry.value,
    allowedSteps: entry.allowedSteps || [binding.step],
    targetScopes:
      entry.targetScopes ||
      (isDeploymentSecretAdmittedReference(binding) ? [binding.targetScope] : ["*"]),
    credentialClass: entry.credentialClass || "routine",
    refreshMode: entry.refreshMode || "none",
    ...(entry.leaseId || entry.referenceId
      ? { leaseId: String(entry.leaseId || entry.referenceId).trim() }
      : {}),
    ...(entry.expiresAt ? { expiresAt: entry.expiresAt } : {}),
  };
}

async function resolveFixtureReference(
  binding: DeploymentSecretContractBinding,
  targetScope: string,
  fixture: DeploymentSecretFixture,
): Promise<DeploymentSecretAdmittedReference | undefined> {
  const entry = fixture.contracts[binding.contractId];
  if (!entry) return undefined;
  const version = deploymentSecretFixtureVersion(entry);
  const selectorRef = deploymentSecretFixtureSelector(binding.contractId, entry);
  return {
    ...binding,
    targetScope,
    backendRef: binding.contractId,
    selectorRef,
    referenceId:
      version && selectorRef ? `vault:${binding.contractId}@${version}` : `vault:${selectorRef}`,
    ...(version ? { resolvedVersion: version } : {}),
    resolvedAt: new Date().toISOString(),
    refreshMode: entry.refreshMode || "none",
    credentialClass: entry.credentialClass || "routine",
  };
}

async function admittedReferenceFor(
  binding: DeploymentSecretContractBinding,
  targetScope: string,
  secretContext?: DeploymentSecretContext,
): Promise<DeploymentSecretAdmittedReference | undefined> {
  const fixture = deploymentSecretFixturePath() ? await readDeploymentSecretFixture() : undefined;
  if (fixture) return await resolveFixtureReference(binding, targetScope, fixture);
  const context = deploymentSecretContext(secretContext);
  if (context?.kind !== "vault") throw missingDeploymentSecretContextError();
  return await resolveDirectVaultSecretReference(binding, targetScope, context.credential);
}

function ensureFixtureReferenceMatches(
  binding: DeploymentSecretAdmittedReference,
  entry: DeploymentSecretFixtureEntry,
) {
  const currentSelector = deploymentSecretFixtureSelector(binding.contractId, entry);
  if (currentSelector !== binding.selectorRef) {
    throw new Error(
      `required secret contract ${binding.contractId} no longer resolves exactly for selector ${binding.selectorRef}`,
    );
  }
  if (!binding.resolvedVersion) return;
  const currentVersion = deploymentSecretFixtureVersion(entry);
  if (currentVersion !== binding.resolvedVersion) {
    throw new Error(
      `required secret contract ${binding.contractId} no longer resolves exactly for version ${binding.resolvedVersion}`,
    );
  }
}

export async function resolveDeploymentVaultAdmittedReferences(opts: {
  requirements: DeploymentRequirement[];
  targetScope: string;
  secretBackendProfile?: string;
  secretContext?: DeploymentSecretContext;
}): Promise<DeploymentSecretAdmittedReference[]> {
  const bindings = deploymentSecretContractBindings(
    opts.requirements,
    "vault",
    opts.secretBackendProfile,
  );
  const resolved: DeploymentSecretAdmittedReference[] = [];
  for (const binding of bindings) {
    const admitted = await admittedReferenceFor(binding, opts.targetScope, opts.secretContext);
    if (!admitted) {
      if (binding.required) {
        throw new Error(`required secret contract ${binding.contractId} is missing`);
      }
      continue;
    }
    resolved.push(admitted);
  }
  return resolved;
}

export function createDeploymentVaultSecretBackend(
  secretContext?: DeploymentSecretContext,
): DeploymentSecretBackend {
  const acquireCounts = new Map<string, number>();
  return {
    async acquire(binding) {
      const context = deploymentSecretContext(secretContext);
      if (!deploymentSecretFixturePath() && context?.kind === "vault") {
        return await acquireDirectVaultSecretReference(binding, context.credential);
      }
      if (!deploymentSecretFixturePath() && context?.kind !== "fixture") {
        throw missingDeploymentSecretContextError();
      }
      const fixture = await readDeploymentSecretFixture();
      const entry = fixture.contracts[binding.contractId];
      if (!entry) throw new Error(`required secret contract ${binding.contractId} is missing`);
      if (isDeploymentSecretAdmittedReference(binding)) {
        ensureFixtureReferenceMatches(binding, entry);
      }
      const count = acquireCounts.get(binding.contractId) || 0;
      acquireCounts.set(binding.contractId, count + 1);
      const selected =
        count > 0 ? mergeDeploymentSecretFixtureEntry(entry, entry.reacquired) : entry;
      return materialFromEntry(binding, selected);
    },
    async renew(secret) {
      if (!deploymentSecretFixturePath()) return undefined;
      const fixture = await readDeploymentSecretFixture();
      const entry = fixture.contracts[secret.binding.contractId];
      if (!entry || entry.revoked || secret.refreshMode !== "renew") return undefined;
      const renewed = mergeDeploymentSecretFixtureEntry(entry, entry.renewed);
      if (isDeploymentSecretAdmittedReference(secret.binding)) {
        ensureFixtureReferenceMatches(secret.binding, renewed);
      }
      return materialFromEntry(secret.binding, renewed);
    },
  };
}
