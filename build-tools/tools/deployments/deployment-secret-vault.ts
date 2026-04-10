#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import type { DeploymentRequirementStep } from "./deployment-requirements.ts";
import type {
  DeploymentSecretBackend,
  DeploymentSecretMaterial,
} from "./deployment-secret-runtime.ts";
import type { DeploymentSecretContractBinding } from "./deployment-secretspec.ts";

const DEPLOYMENT_VAULT_FIXTURE_SCHEMA = "deployment-vault-fixture@1";

type DeploymentVaultFixtureEntry = {
  value: string;
  referenceId?: string;
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
  return String(process.env.BNX_DEPLOYMENT_VAULT_FIXTURE_PATH || "").trim();
}

async function readFixture(): Promise<DeploymentVaultFixture> {
  const filePath = fixturePath();
  if (!filePath) {
    throw new Error(
      "secret-consuming protected/shared runs require BNX_DEPLOYMENT_VAULT_FIXTURE_PATH",
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

function materialFromEntry(
  binding: DeploymentSecretContractBinding,
  entry: DeploymentVaultFixtureEntry,
): DeploymentSecretMaterial {
  if (entry.revoked) {
    throw new Error(`required secret contract ${binding.contractId} is revoked`);
  }
  return {
    binding,
    value: entry.value,
    allowedSteps: entry.allowedSteps || [binding.step],
    targetScopes: entry.targetScopes || ["*"],
    credentialClass: entry.credentialClass || "routine",
    refreshMode: entry.refreshMode || "none",
    ...(entry.referenceId ? { leaseId: entry.leaseId || entry.referenceId } : {}),
    ...(entry.referenceId ? { binding: { ...binding, referenceId: entry.referenceId } } : {}),
    ...(entry.expiresAt ? { expiresAt: entry.expiresAt } : {}),
  };
}

export function createDeploymentVaultSecretBackend(): DeploymentSecretBackend {
  const acquireCounts = new Map<string, number>();
  return {
    async acquire(binding) {
      const fixture = await readFixture();
      const entry = fixture.contracts[binding.contractId];
      if (!entry) throw new Error(`required secret contract ${binding.contractId} is missing`);
      const count = acquireCounts.get(binding.contractId) || 0;
      acquireCounts.set(binding.contractId, count + 1);
      const selected = count > 0 ? mergedEntry(entry, entry.reacquired) : entry;
      return materialFromEntry(binding, selected);
    },
    async renew(secret) {
      const fixture = await readFixture();
      const entry = fixture.contracts[secret.binding.contractId];
      if (!entry || entry.revoked || secret.refreshMode !== "renew") return undefined;
      const renewed = mergedEntry(entry, entry.renewed);
      return materialFromEntry(secret.binding, renewed);
    },
  };
}
