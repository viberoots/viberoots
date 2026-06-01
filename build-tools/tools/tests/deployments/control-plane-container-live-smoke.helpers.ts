#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import { promisify } from "node:util";
import pg from "pg";
import { validateProviderCapabilityEvidence } from "../../deployments/cloud-control-provider-capability-readiness";
import type { ControlPlaneManagedDependencyProfile } from "../../deployments/control-plane-managed-dependency-types";
import { validateManagedArtifactStoreProfile } from "../../deployments/control-plane-managed-dependency-validation";
import type { ProviderCapabilityDeclaration } from "../../deployments/cloud-control-setup-types";
import {
  awsTopologyInputs,
  expectedEc2HostModeFromLiveProfile,
  validateAwsProviderCapabilityEvidence,
  validateOptionalAwsTopology,
} from "./control-plane-container-live-smoke-aws.helpers";
import { collectCutoverEvidence } from "../../deployments/cloud-control-cutover-evidence-collector";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";

const execFileAsync = promisify(execFile);

export function liveSmokeEnv(t: { skip(reason?: string): void }) {
  if (process.env.VBR_CONTROL_PLANE_LIVE_SMOKE !== "1") {
    t.skip("optional live smoke disabled; set VBR_CONTROL_PLANE_LIVE_SMOKE=1");
    return undefined;
  }
  const required = [
    "VBR_CONTROL_PLANE_LIVE_SERVICE_URL",
    "VBR_CONTROL_PLANE_LIVE_TOKEN_FILE",
    "VBR_CONTROL_PLANE_LIVE_DATABASE_URL_FILE",
    "VBR_CONTROL_PLANE_LIVE_ARTIFACT_ENDPOINT_FILE",
    "VBR_CONTROL_PLANE_LIVE_ARTIFACT_ACCESS_KEY_ID_FILE",
    "VBR_CONTROL_PLANE_LIVE_ARTIFACT_SECRET_ACCESS_KEY_FILE",
    "VBR_CONTROL_PLANE_LIVE_ARTIFACT_BUCKET",
    "VBR_CONTROL_PLANE_LIVE_ARTIFACT_REGION",
    "VBR_CONTROL_PLANE_LIVE_AUTH_PROVIDER",
    "VBR_CONTROL_PLANE_LIVE_DEPLOYMENT_STAGE",
    "VBR_CONTROL_PLANE_LIVE_STAGING_DEPLOY_SMOKE_COMMAND",
    "VBR_CONTROL_PLANE_LIVE_PROVIDER_CAPABILITIES_FILE",
    "VBR_CONTROL_PLANE_LIVE_PROVIDER_CAPABILITY_EVIDENCE_FILE",
    ...authValidationInputs(process.env.VBR_CONTROL_PLANE_LIVE_AUTH_PROVIDER || ""),
    ...awsTopologyInputs(process.env),
    ...cutoverValidationInputs(process.env),
  ];
  const values = Object.fromEntries(required.map((name) => [name, process.env[name] || ""]));
  const missing = required.filter((name) => !String(values[name]).trim());
  assert.deepEqual(missing, [], `live smoke enabled but missing ${missing.join(", ")}`);
  assert.doesNotMatch(values.VBR_CONTROL_PLANE_LIVE_DEPLOYMENT_STAGE, /^(prod|production)$/i);
  assert.doesNotMatch(values.VBR_CONTROL_PLANE_LIVE_DEPLOYMENT_STAGE, /^protected/i);
  return { ...process.env, ...values } as Record<string, string>;
}

export function authValidationInputs(provider: string): string[] {
  if (provider === "workos") return ["VBR_CONTROL_PLANE_LIVE_WORKOS_JWKS_URL"];
  if (provider === "supabase-auth") {
    return [
      "VBR_CONTROL_PLANE_LIVE_SUPABASE_AUTH_HEALTH_URL",
      "VBR_CONTROL_PLANE_LIVE_SUPABASE_AUTH_JWKS_URL",
    ];
  }
  if (provider === "oidc" || provider === "generic-oidc") {
    return ["VBR_CONTROL_PLANE_LIVE_OIDC_DISCOVERY_URL"];
  }
  return [];
}

export { awsTopologyInputs };

export function cutoverValidationInputs(env: NodeJS.ProcessEnv): string[] {
  if (env.VBR_CONTROL_PLANE_LIVE_CUTOVER !== "1") return [];
  return [
    "VBR_CONTROL_PLANE_LIVE_CUTOVER_BUNDLE_DIR",
    "VBR_CONTROL_PLANE_LIVE_CUTOVER_EXPECTED_HOST_PROFILE",
    "VBR_CONTROL_PLANE_LIVE_CUTOVER_EXPECTED_IMAGE_BUILD_IDENTITY",
    "VBR_CONTROL_PLANE_LIVE_CUTOVER_EXPECTED_REGION",
    "VBR_CONTROL_PLANE_LIVE_CUTOVER_SELECTED_CAPABILITIES",
  ];
}

export async function validateLiveControlPlaneSmoke(env: Record<string, string>) {
  const token = (await fsp.readFile(env.VBR_CONTROL_PLANE_LIVE_TOKEN_FILE, "utf8")).trim();
  const base = new URL(env.VBR_CONTROL_PLANE_LIVE_SERVICE_URL);
  await assertOkJson(new URL("/healthz", base), "health");
  await assertOkJson(new URL("/readyz", base), "readiness", token);
  const heartbeats = await assertOkJson(
    new URL("/api/v1/worker-heartbeats", base),
    "workers",
    token,
  );
  assert.ok(Array.isArray(heartbeats.workers) && heartbeats.workers.length >= 2);
  await validateLiveDbConnectivity(env.VBR_CONTROL_PLANE_LIVE_DATABASE_URL_FILE);
  await validateLiveArtifactStore(env);
  await validateLiveProviderCapabilityEvidence(env);
  await validateAuthProvider(env);
  await validateOptionalAwsTopology(env, token, assertOkJson);
  await validateStagingDeploySmoke(env);
  await validateLiveCutoverEvidence(env);
}

export async function assertOkJson(url: URL, label: string, token?: string) {
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  assert.equal(
    response.status,
    200,
    `${label} returned ${response.status}: ${await response.text()}`,
  );
  return await response.json();
}

async function validateLiveDbConnectivity(databaseUrlFile: string) {
  const pool = new pg.Pool({
    connectionString: (await fsp.readFile(databaseUrlFile, "utf8")).trim(),
    max: 1,
    connectionTimeoutMillis: 10_000,
    application_name: "viberoots-cloud-control-live-smoke",
  });
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT 1 AS ok");
    assert.equal(result.rows[0]?.ok, 1);
  } finally {
    client.release();
    await pool.end();
  }
}

async function validateLiveArtifactStore(env: Record<string, string>) {
  const profile: ControlPlaneManagedDependencyProfile = {
    profileName: "cloud-control-live-smoke",
    postgres: {
      provider: "postgres-compatible",
      urlFile: env.VBR_CONTROL_PLANE_LIVE_DATABASE_URL_FILE,
    },
    artifactStore: {
      provider: "s3-compatible",
      bucket: env.VBR_CONTROL_PLANE_LIVE_ARTIFACT_BUCKET,
      region: env.VBR_CONTROL_PLANE_LIVE_ARTIFACT_REGION,
      endpointFile: env.VBR_CONTROL_PLANE_LIVE_ARTIFACT_ENDPOINT_FILE,
      accessKeyIdFile: env.VBR_CONTROL_PLANE_LIVE_ARTIFACT_ACCESS_KEY_ID_FILE,
      secretAccessKeyFile: env.VBR_CONTROL_PLANE_LIVE_ARTIFACT_SECRET_ACCESS_KEY_FILE,
      keyPrefix: env.VBR_CONTROL_PLANE_LIVE_ARTIFACT_PREFIX || "tmp/vbr-cloud-control-live-smoke",
    },
  };
  const evidence = await validateManagedArtifactStoreProfile(profile);
  for (const op of ["PUT", "GET", "HEAD"]) assert.ok(evidence.checkedOperations.includes(op));
}

async function validateAuthProvider(env: Record<string, string>) {
  const provider = env.VBR_CONTROL_PLANE_LIVE_AUTH_PROVIDER;
  if (provider === "workos") {
    await assertJwks(env.VBR_CONTROL_PLANE_LIVE_WORKOS_JWKS_URL, "WorkOS");
    return;
  }
  if (provider === "supabase-auth") {
    await assertOkFetch(env.VBR_CONTROL_PLANE_LIVE_SUPABASE_AUTH_HEALTH_URL, "Supabase Auth");
    await assertJwks(env.VBR_CONTROL_PLANE_LIVE_SUPABASE_AUTH_JWKS_URL, "Supabase Auth");
    return;
  }
  if (provider === "oidc" || provider === "generic-oidc") {
    const discovery = await assertOkJsonUrl(env.VBR_CONTROL_PLANE_LIVE_OIDC_DISCOVERY_URL, "OIDC");
    assert.ok(discovery.issuer);
    assert.ok(discovery.jwks_uri);
    await assertJwks(discovery.jwks_uri, "OIDC");
    return;
  }
  assert.fail(`unsupported auth provider ${provider}`);
}

async function validateStagingDeploySmoke(env: Record<string, string>) {
  assert.match(env.VBR_CONTROL_PLANE_LIVE_DEPLOYMENT_STAGE, /^(staging|shared_nonprod)$/i);
  await execFileAsync("sh", ["-c", env.VBR_CONTROL_PLANE_LIVE_STAGING_DEPLOY_SMOKE_COMMAND], {
    timeout: 300_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function validateLiveProviderCapabilityEvidence(env: Record<string, string>) {
  const declarations = JSON.parse(
    await fsp.readFile(env.VBR_CONTROL_PLANE_LIVE_PROVIDER_CAPABILITIES_FILE, "utf8"),
  ) as ProviderCapabilityDeclaration[];
  const evidenceByCapability = JSON.parse(
    await fsp.readFile(env.VBR_CONTROL_PLANE_LIVE_PROVIDER_CAPABILITY_EVIDENCE_FILE, "utf8"),
  ) as Record<string, string[]>;
  const expectedEc2HostMode = await expectedEc2HostModeFromLiveProfile(env);
  const errors = validateProviderCapabilityEvidence(declarations, evidenceByCapability, {
    expectedEc2HostMode,
  });
  assert.deepEqual(errors, [], errors.join("; "));
  await validateAwsProviderCapabilityEvidence(env, declarations, evidenceByCapability);
}

async function validateLiveCutoverEvidence(env: Record<string, string>) {
  if (env.VBR_CONTROL_PLANE_LIVE_CUTOVER !== "1") return;
  const evidence = await collectCutoverEvidence(env.VBR_CONTROL_PLANE_LIVE_CUTOVER_BUNDLE_DIR);
  const result = validateCloudControlCutover(evidence, {
    operation: "cutover",
    expectedHostProfile: env.VBR_CONTROL_PLANE_LIVE_CUTOVER_EXPECTED_HOST_PROFILE,
    expectedImageBuildIdentity: env.VBR_CONTROL_PLANE_LIVE_CUTOVER_EXPECTED_IMAGE_BUILD_IDENTITY,
    expectedRegion: env.VBR_CONTROL_PLANE_LIVE_CUTOVER_EXPECTED_REGION,
    selectedCapabilities: env.VBR_CONTROL_PLANE_LIVE_CUTOVER_SELECTED_CAPABILITIES.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    maxAgeMinutes: Number(env.VBR_CONTROL_PLANE_LIVE_CUTOVER_MAX_AGE_MINUTES || "60"),
  });
  assert.deepEqual(result.errors, [], result.errors.join("; "));
}

async function assertOkFetch(url: string, label: string) {
  assert.ok(url, `${label} validation URL is required`);
  const response = await fetch(url);
  assert.equal(response.status, 200, `${label} returned ${response.status}`);
}

async function assertOkJsonUrl(url: string, label: string) {
  assert.ok(url, `${label} validation URL is required`);
  const response = await fetch(url);
  assert.equal(response.status, 200, `${label} returned ${response.status}`);
  return await response.json();
}

async function assertJwks(url: string, label: string) {
  const body = await assertOkJsonUrl(url, `${label} JWKS`);
  assert.ok(Array.isArray(body.keys) && body.keys.length > 0, `${label} JWKS has no keys`);
}
