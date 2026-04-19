#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import type { DeploymentRequirementStep } from "./deployment-requirements.ts";

export const DEPLOYMENT_SECRET_FIXTURE_SCHEMA = "deployment-secret-fixture@1";
export const DEPLOYMENT_SECRET_FIXTURE_PATH_ENV = "BNX_DEPLOYMENT_SECRET_FIXTURE_PATH";

export type DeploymentSecretFixtureEntry = {
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
  renewed?: Partial<DeploymentSecretFixtureEntry>;
  reacquired?: Partial<DeploymentSecretFixtureEntry>;
};

export type DeploymentSecretFixture = {
  schemaVersion: typeof DEPLOYMENT_SECRET_FIXTURE_SCHEMA;
  contracts: Record<string, DeploymentSecretFixtureEntry>;
};

export function deploymentSecretFixturePath(): string {
  return String(process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] || "").trim();
}

export async function readDeploymentSecretFixture(): Promise<DeploymentSecretFixture> {
  const filePath = deploymentSecretFixturePath();
  if (!filePath) {
    throw new Error(
      `secret-consuming protected/shared runs require either ${DEPLOYMENT_SECRET_FIXTURE_PATH_ENV} for the reviewed local/test secret fixture or VAULT_ADDR plus BNX_VAULT_AUTH_METHOD=jwt for production Vault runtime`,
    );
  }
  const parsed = JSON.parse(await fsp.readFile(filePath, "utf8")) as DeploymentSecretFixture;
  if (parsed.schemaVersion !== DEPLOYMENT_SECRET_FIXTURE_SCHEMA || !parsed.contracts) {
    throw new Error(`invalid deployment secret fixture: ${filePath}`);
  }
  return parsed;
}

export function mergeDeploymentSecretFixtureEntry(
  base: DeploymentSecretFixtureEntry,
  override: Partial<DeploymentSecretFixtureEntry> | undefined,
): DeploymentSecretFixtureEntry {
  return { ...base, ...(override || {}) };
}

export function deploymentSecretFixtureSelector(
  contractId: string,
  entry: DeploymentSecretFixtureEntry,
): string {
  return String(entry.referenceId || contractId).trim();
}

export function deploymentSecretFixtureVersion(
  entry: DeploymentSecretFixtureEntry,
): string | undefined {
  const version = entry.version ?? entry.leaseId;
  if (version === undefined || version === null) return undefined;
  const normalized = String(version).trim();
  return normalized ? normalized : undefined;
}
