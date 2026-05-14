#!/usr/bin/env zx-wrapper
import type { DeploymentRequirement } from "./deployment-requirements";
import {
  deploymentSecretContractBindings,
  isDeploymentSecretAdmittedReference,
  type DeploymentSecretAdmittedReference,
  type DeploymentSecretContractBinding,
  type DeploymentSecretReference,
} from "./deployment-sprinkle-ref";
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
  type DeploymentSecretFixtureEntry,
} from "./deployment-secret-fixture";
import {
  deploymentSecretContext,
  missingDeploymentSecretContextError,
  type DeploymentSecretContext,
} from "./deployment-secret-context";
import type {
  DeploymentInfisicalRuntimeConfig,
  DeploymentInfisicalSecretMapping,
} from "./deployment-secret-metadata";
import {
  readInfisicalSecret,
  type InfisicalSecretRecord,
} from "./deployment-secret-infisical-client";
import {
  deploymentInfisicalBackendRef,
  deploymentInfisicalSelector,
  deploymentInfisicalSelectorRef,
  parseDeploymentInfisicalBackendRef,
} from "./deployment-secret-infisical-selectors";

function materialFromFixture(
  binding: DeploymentSecretReference,
  entry: DeploymentSecretFixtureEntry,
): DeploymentSecretMaterial {
  if (entry.revoked) throw new Error(`required secret contract ${binding.contractId} is revoked`);
  return {
    binding,
    value: entry.value,
    allowedSteps: entry.allowedSteps || [binding.step],
    targetScopes:
      entry.targetScopes ||
      (isDeploymentSecretAdmittedReference(binding) ? [binding.targetScope] : ["*"]),
    credentialClass: entry.credentialClass || "routine",
    refreshMode: entry.refreshMode || "none",
  };
}

function fixtureAdmittedReference(
  binding: DeploymentSecretContractBinding,
  targetScope: string,
  entry: DeploymentSecretFixtureEntry,
): DeploymentSecretAdmittedReference {
  const version = deploymentSecretFixtureVersion(entry) || "fixture-v1";
  const selector = deploymentSecretFixtureSelector(binding.contractId, entry);
  return {
    ...binding,
    targetScope,
    backendRef: `fixture:${selector}`,
    selectorRef: `fixture:${selector}@${version}`,
    referenceId: `infisical:fixture:${selector}@${version}`,
    resolvedVersion: version,
    resolvedAt: new Date().toISOString(),
    refreshMode: entry.refreshMode || "none",
    credentialClass: entry.credentialClass || "routine",
  };
}

function ensureFixtureMatches(
  binding: DeploymentSecretAdmittedReference,
  entry: DeploymentSecretFixtureEntry,
) {
  const version = deploymentSecretFixtureVersion(entry) || "fixture-v1";
  const selector = deploymentSecretFixtureSelector(binding.contractId, entry);
  if (binding.selectorRef !== `fixture:${selector}@${version}`) {
    throw new Error(`required secret contract ${binding.contractId} no longer resolves exactly`);
  }
}

function assertContext(context?: DeploymentSecretContext) {
  const resolved = deploymentSecretContext(context);
  if (resolved?.kind !== "infisical") throw missingDeploymentSecretContextError();
  return resolved;
}

async function readAdmittedSecret(opts: {
  credential: DeploymentSecretContext & { kind: "infisical" };
  selector: ReturnType<typeof deploymentInfisicalSelector>;
}) {
  return await readInfisicalSecret({
    credential: opts.credential.credential,
    selector: opts.selector,
    viewSecretValue: false,
  });
}

function assertUsable(record: InfisicalSecretRecord | undefined, contractId: string) {
  if (!record || record.deleted || record.revoked || record.unavailable) {
    throw new Error(`required secret contract ${contractId} is missing`);
  }
  return record;
}

function assertSelector(
  record: InfisicalSecretRecord,
  admitted: DeploymentSecretAdmittedReference,
) {
  const parsed = parseDeploymentInfisicalBackendRef(admitted.backendRef);
  for (const [field, actual, expected] of [
    ["project", record.projectId, parsed.selector.projectId],
    ["environment", record.environment, parsed.selector.environment],
    ["path", record.secretPath, parsed.selector.secretPath],
    ["name", record.secretName, parsed.selector.secretName],
    ["id", record.id, parsed.identity.id],
    ["reference", record.reference, parsed.identity.reference],
    ["version", record.version, admitted.resolvedVersion],
  ] as const) {
    if (expected && actual !== expected) {
      throw new Error(
        `required secret contract ${admitted.contractId} no longer resolves exactly for ${field}`,
      );
    }
  }
}

export async function resolveDeploymentInfisicalAdmittedReferences(opts: {
  requirements: DeploymentRequirement[];
  targetScope: string;
  runtime?: DeploymentInfisicalRuntimeConfig;
  mappings?: Record<string, DeploymentInfisicalSecretMapping>;
  secretContext?: DeploymentSecretContext;
}): Promise<DeploymentSecretAdmittedReference[]> {
  const bindings = deploymentSecretContractBindings(opts.requirements, "infisical");
  const fixture = deploymentSecretFixturePath() ? await readDeploymentSecretFixture() : undefined;
  const context = fixture ? undefined : assertContext(opts.secretContext);
  if (!fixture && !opts.runtime) throw missingDeploymentSecretContextError();
  const resolved: DeploymentSecretAdmittedReference[] = [];
  for (const binding of bindings) {
    const entry = fixture?.contracts[binding.contractId];
    if (fixture && entry) {
      resolved.push(fixtureAdmittedReference(binding, opts.targetScope, entry));
      continue;
    }
    if (fixture) {
      if (binding.required)
        throw new Error(`required secret contract ${binding.contractId} is missing`);
      continue;
    }
    const selector = deploymentInfisicalSelector({
      binding,
      runtime: opts.runtime!,
      mappings: opts.mappings,
    });
    const record = await readAdmittedSecret({ credential: context!, selector });
    if (!record) {
      if (binding.required)
        throw new Error(`required secret contract ${binding.contractId} is missing`);
      continue;
    }
    const usable = assertUsable(record, binding.contractId);
    if (!usable.version) {
      throw new Error(
        `required secret contract ${binding.contractId} missing exact Infisical version`,
      );
    }
    const backendRef = deploymentInfisicalBackendRef(selector, {
      id: usable.id,
      reference: usable.reference,
    });
    resolved.push({
      ...binding,
      targetScope: opts.targetScope,
      backendRef,
      selectorRef: deploymentInfisicalSelectorRef(selector, usable.version),
      referenceId: `infisical:${backendRef}@${usable.version}`,
      resolvedVersion: usable.version,
      resolvedAt: new Date().toISOString(),
      refreshMode: "none",
      credentialClass: "routine",
    });
  }
  return resolved;
}

export function createDeploymentInfisicalSecretBackend(
  secretContext?: DeploymentSecretContext,
): DeploymentSecretBackend {
  return {
    async acquire(binding) {
      if (deploymentSecretFixturePath()) {
        const fixture = await readDeploymentSecretFixture();
        const entry = fixture.contracts[binding.contractId];
        if (!entry) throw new Error(`required secret contract ${binding.contractId} is missing`);
        if (isDeploymentSecretAdmittedReference(binding)) ensureFixtureMatches(binding, entry);
        return materialFromFixture(
          binding,
          mergeDeploymentSecretFixtureEntry(entry, entry.reacquired),
        );
      }
      const context = assertContext(secretContext);
      if (!isDeploymentSecretAdmittedReference(binding) || !binding.resolvedVersion) {
        throw new Error(
          `required secret contract ${binding.contractId} has no exact Infisical replay reference`,
        );
      }
      const { selector } = parseDeploymentInfisicalBackendRef(binding.backendRef);
      const record = assertUsable(
        await readInfisicalSecret({
          credential: context.credential,
          selector,
          viewSecretValue: true,
          version: binding.resolvedVersion,
        }),
        binding.contractId,
      );
      assertSelector(record, binding);
      if (typeof record.secretValue !== "string") {
        throw new Error(
          `required secret contract ${binding.contractId} does not expose a string value`,
        );
      }
      return {
        binding,
        value: record.secretValue,
        allowedSteps: [binding.step],
        targetScopes: [binding.targetScope],
        credentialClass: binding.credentialClass,
        refreshMode: binding.refreshMode,
      };
    },
  };
}
