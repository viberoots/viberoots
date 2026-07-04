#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEPLOYMENT_SECRET_FIXTURE_PATH_ENV,
  DEPLOYMENT_SECRET_FIXTURE_SCHEMA,
} from "../../deployments/deployment-secret-fixture";
import {
  createDeploymentInfisicalSecretBackend,
  resolveDeploymentInfisicalAdmittedReferences,
} from "../../deployments/deployment-secret-infisical";
import { createDeploymentSecretRuntime } from "../../deployments/deployment-secret-runtime";
import type { DeploymentSecretContext } from "../../deployments/deployment-secret-context";
import type { DeploymentSecretAdmittedReference } from "../../deployments/deployment-sprinkle-ref";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture";
import type { FakeInfisicalSecret } from "./infisical.test-server";

export const infisicalContractId = "secret://deployments/sample-webapp/cloudflare_api_token";
export const infisicalTargetScope =
  "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages";
export const infisicalRuntime = {
  siteUrl: "http://127.0.0.1",
  projectId: "proj_123",
  environment: "prod",
  secretPath: "/deployments/sample-webapp",
} as const;
export const infisicalRequirement = deploymentRequirementFixture({
  name: "cloudflare_api_token",
  step: "publish",
  contractId: infisicalContractId,
});

const originalEnv = { ...process.env };

export function restoreInfisicalTestEnv() {
  process.env = { ...originalEnv };
}

export function infisicalTestContext(
  siteUrl: string,
  opts: { clientSecret?: string } = {},
): DeploymentSecretContext {
  return {
    kind: "infisical",
    credential: {
      kind: "universal_auth",
      siteUrl,
      clientId: "id",
      clientSecret: opts.clientSecret || "secret",
    },
  };
}

export function infisicalSecret(overrides: Partial<FakeInfisicalSecret> = {}): FakeInfisicalSecret {
  return {
    id: "sec_1",
    projectId: "proj_123",
    environment: "prod",
    secretPath: "/deployments/sample-webapp",
    secretName: "cloudflare_api_token",
    version: "3",
    secretValue: "runtime-token-v3",
    ...overrides,
  };
}

export async function admitInfisicalSecret(
  siteUrl: string,
  opts: { clientSecret?: string } = {},
): Promise<DeploymentSecretAdmittedReference> {
  const admitted = await resolveDeploymentInfisicalAdmittedReferences({
    requirements: [infisicalRequirement],
    targetScope: infisicalTargetScope,
    runtime: { ...infisicalRuntime, siteUrl },
    secretContext: infisicalTestContext(siteUrl, opts),
  });
  return admitted[0]!;
}

export async function acquireInfisicalSecret(opts: {
  siteUrl: string;
  admitted: DeploymentSecretAdmittedReference;
  clientSecret?: string;
}) {
  const runtime = createDeploymentSecretRuntime({
    backend: createDeploymentInfisicalSecretBackend(
      infisicalTestContext(opts.siteUrl, { clientSecret: opts.clientSecret }),
    ),
    admittedReferences: [opts.admitted],
    targetScope: infisicalTargetScope,
  });
  return await runtime.enterStep("publish");
}

export async function withInfisicalFixtureFile(
  contracts: Record<string, unknown>,
  run: () => Promise<void>,
) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "deployment-secret-infisical-"));
  process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = path.join(tmp, "fixture.json");
  await fsp.writeFile(
    process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV]!,
    JSON.stringify({ schemaVersion: DEPLOYMENT_SECRET_FIXTURE_SCHEMA, contracts }),
  );
  try {
    await run();
  } finally {
    restoreInfisicalTestEnv();
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}
