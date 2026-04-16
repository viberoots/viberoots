#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import type { DeploymentRequirementStep } from "./deployment-requirements.ts";
import type {
  DeploymentSecretBackend,
  DeploymentSecretMaterial,
} from "./deployment-secret-runtime.ts";
import {
  acquireDirectVaultSecretReference,
  hasDirectVaultEnv,
  resolveDirectVaultSecretReference,
} from "./deployment-secret-vault-direct.ts";
import {
  deploymentSecretContractBindings,
  isDeploymentSecretAdmittedReference,
  type DeploymentSecretAdmittedReference,
  type DeploymentSecretContractBinding,
  type DeploymentSecretReference,
} from "./deployment-secretspec.ts";
import type { DeploymentRequirement } from "./deployment-requirements.ts";

const DEPLOYMENT_VAULT_FIXTURE_SCHEMA = "deployment-vault-fixture@1";
const DEPLOYMENT_SECRET_FIXTURE_PATH_ENV = "BNX_DEPLOYMENT_SECRET_FIXTURE_PATH";

type DeploymentVaultFixtureEntry = {
  value: string;
  referenceId?: string;
  version?: string | number;
  leaseId?: string;
  expiresAt?: string;
  refreshMode?: "renew" | "reacquire" | "none";
  credentialClass?: "routine" | "break_glass";
  allowedSteps?: DeploymentRequirementStep[];
  targetScopes?: string[];
  revoked?: boolean;
  renewed?: Partial<DeploymentVaultFixtureEntry>;
  reacquired?: Partial<DeploymentVaultFixtureEntry>;
};

type DeploymentVaultFixture = {
  schemaVersion: typeof DEPLOYMENT_VAULT_FIXTURE_SCHEMA;
  contracts: Record<string, DeploymentVaultFixtureEntry>;
};

function fixturePath(): string {
  return String(process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] || "").trim();
}

async function readFixture(): Promise<DeploymentVaultFixture> {
  const filePath = fixturePath();
  if (!filePath) {
    throw new Error(
      `secret-consuming protected/shared runs require either ${DEPLOYMENT_SECRET_FIXTURE_PATH_ENV} for the reviewed local/test fixture override or VAULT_ADDR plus VAULT_TOKEN for direct Vault runtime`,
    );
  }
  const parsed = JSON.parse(await fsp.readFile(filePath, "utf8")) as DeploymentVaultFixture;
  if (parsed.schemaVersion !== DEPLOYMENT_VAULT_FIXTURE_SCHEMA || !parsed.contracts) {
    throw new Error(`invalid deployment vault fixture: ${filePath}`);
  }
  return parsed;
}

function mergedEntry(
  base: DeploymentVaultFixtureEntry,
  override: Partial<DeploymentVaultFixtureEntry> | undefined,
): DeploymentVaultFixtureEntry {
  return { ...base, ...(override || {}) };
}

function admittedFixtureSelector(contractId: string, entry: DeploymentVaultFixtureEntry): string {
  return String(entry.referenceId || contractId).trim();
}

function admittedFixtureVersion(entry: DeploymentVaultFixtureEntry): string | undefined {
  const version = entry.version ?? entry.leaseId;
  if (version === undefined || version === null) return undefined;
  const normalized = String(version).trim();
  return normalized ? normalized : undefined;
}

function materialFromEntry(
  binding: DeploymentSecretReference,
  entry: DeploymentVaultFixtureEntry,
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
  fixture: DeploymentVaultFixture,
): Promise<DeploymentSecretAdmittedReference | undefined> {
  const entry = fixture.contracts[binding.contractId];
  if (!entry) return undefined;
  const version = admittedFixtureVersion(entry);
  const selectorRef = admittedFixtureSelector(binding.contractId, entry);
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
): Promise<DeploymentSecretAdmittedReference | undefined> {
  const fixture = fixturePath() ? await readFixture() : undefined;
  if (fixture) return await resolveFixtureReference(binding, targetScope, fixture);
  return await resolveDirectVaultSecretReference(binding, targetScope);
}

function ensureFixtureReferenceMatches(
  binding: DeploymentSecretAdmittedReference,
  entry: DeploymentVaultFixtureEntry,
) {
  const currentSelector = admittedFixtureSelector(binding.contractId, entry);
  if (currentSelector !== binding.selectorRef) {
    throw new Error(
      `required secret contract ${binding.contractId} no longer resolves exactly for selector ${binding.selectorRef}`,
    );
  }
  if (!binding.resolvedVersion) return;
  const currentVersion = admittedFixtureVersion(entry);
  if (currentVersion !== binding.resolvedVersion) {
    throw new Error(
      `required secret contract ${binding.contractId} no longer resolves exactly for version ${binding.resolvedVersion}`,
    );
  }
}

async function acquireDirectReference(
  binding: DeploymentSecretReference,
): Promise<DeploymentSecretMaterial> {
  const version = isDeploymentSecretAdmittedReference(binding)
    ? binding.resolvedVersion
    : undefined;
  const response = await vaultRequest<{
    data?: { data?: Record<string, unknown>; metadata?: { version?: number } };
  }>(
    vaultApiPath(binding.contractId, "data"),
    version ? new URLSearchParams({ version }) : undefined,
  );
  if (response.status === 404 || !response.data?.data?.data) {
    throw new Error(`required secret contract ${binding.contractId} is missing`);
  }
  const value = response.data.data.data.value;
  if (typeof value !== "string") {
    throw new Error(
      `required secret contract ${binding.contractId} does not expose string data.value`,
    );
  }
  return {
    binding,
    value,
    allowedSteps: [binding.step],
    targetScopes: [isDeploymentSecretAdmittedReference(binding) ? binding.targetScope : "*"],
    credentialClass: isDeploymentSecretAdmittedReference(binding)
      ? binding.credentialClass
      : "routine",
    refreshMode: isDeploymentSecretAdmittedReference(binding) ? binding.refreshMode : "none",
  };
}

export async function resolveDeploymentVaultAdmittedReferences(opts: {
  requirements: DeploymentRequirement[];
  targetScope: string;
}): Promise<DeploymentSecretAdmittedReference[]> {
  const bindings = deploymentSecretContractBindings(opts.requirements);
  const resolved: DeploymentSecretAdmittedReference[] = [];
  for (const binding of bindings) {
    const admitted = await admittedReferenceFor(binding, opts.targetScope);
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

export function createDeploymentVaultSecretBackend(): DeploymentSecretBackend {
  const acquireCounts = new Map<string, number>();
  return {
    async acquire(binding) {
      if (!fixturePath() && hasDirectVaultEnv())
        return await acquireDirectVaultSecretReference(binding);
      const fixture = await readFixture();
      const entry = fixture.contracts[binding.contractId];
      if (!entry) throw new Error(`required secret contract ${binding.contractId} is missing`);
      if (isDeploymentSecretAdmittedReference(binding)) {
        ensureFixtureReferenceMatches(binding, entry);
      }
      const count = acquireCounts.get(binding.contractId) || 0;
      acquireCounts.set(binding.contractId, count + 1);
      const selected = count > 0 ? mergedEntry(entry, entry.reacquired) : entry;
      return materialFromEntry(binding, selected);
    },
    async renew(secret) {
      if (!fixturePath()) return undefined;
      const fixture = await readFixture();
      const entry = fixture.contracts[secret.binding.contractId];
      if (!entry || entry.revoked || secret.refreshMode !== "renew") return undefined;
      const renewed = mergedEntry(entry, entry.renewed);
      if (isDeploymentSecretAdmittedReference(secret.binding)) {
        ensureFixtureReferenceMatches(secret.binding, renewed);
      }
      return materialFromEntry(secret.binding, renewed);
    },
  };
}
