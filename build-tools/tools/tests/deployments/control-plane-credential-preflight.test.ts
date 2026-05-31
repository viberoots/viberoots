#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { runCredentialPreflight } from "../../deployments/control-plane-credential-preflight";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { defaultReviewedRuntimeInput } from "../../deployments/cloud-control-runtime-input";
import { runInScratchTemp } from "../lib/test-helpers";
import { privateLinkAwsTopology, topologyForPublishedImage } from "./cloud-control-cutover-fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const DIGEST = `sha256:${"e".repeat(64)}`;
const BUILD_IDENTITY = `nix-source-${"f".repeat(64)}`;

test("credential preflight accepts exact generated manifest files", async () => {
  await runInScratchTemp("credential-preflight-pass", async (tmp) => {
    await writeFixture(tmp, input());
    const result = await runCredentialPreflight({
      bundleDir: tmp,
      credentialDirectory: path.join(tmp, "credentials"),
      env: {},
    });
    assert.equal(result.ok, true);
    assert.ok(result.checkedFiles.includes("pleomino-staging-infisical-client-secret"));
  });
});

test("credential preflight accepts AWS instance-profile manifests without static S3 keys", async () => {
  await runInScratchTemp("credential-preflight-instance-profile", async (tmp) => {
    await writeFixture(
      tmp,
      input({
        artifactCredentialMode: "aws-instance-profile",
        artifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-artifacts",
        artifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
      }),
    );
    const result = await runCredentialPreflight({
      bundleDir: tmp,
      credentialDirectory: path.join(tmp, "credentials"),
      env: {},
    });
    assert.equal(result.ok, true);
    assert.ok(!result.checkedFiles.includes("artifact-store-access-key-id"));
  });
});

test("credential preflight rejects missing, empty, URL, env, and stale deployment inputs", async () => {
  await runInScratchTemp("credential-preflight-fail", async (tmp) => {
    await writeFixture(tmp, input());
    const manifestPath = path.join(tmp, "credential-manifest.json");
    const credentialMapPath = path.join(tmp, "credential-map.json");
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    const credentialMap = JSON.parse(await fsp.readFile(credentialMapPath, "utf8"));
    manifest.reviewedSourceMode = "github-app";
    manifest.deploymentIds = ["old-staging"];
    manifest.requiredFiles = manifest.requiredFiles
      .filter((file: string) => file !== "artifact-store-secret-access-key")
      .concat("env:DATABASE_URL", "old-staging-infisical-client-secret");
    await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    credentialMap.databaseUrl.supabaseProjectRef = "wrong-project";
    credentialMap.databaseUrl.hostnameEvidenceRef = "evidence://supabase/test/hostname";
    credentialMap.reviewedSource.mode = "ssh";
    credentialMap.reviewedSource.evidenceRef = "self-attested";
    credentialMap.infisical.requiredSecretNamePlanRef = "evidence://placeholder";
    credentialMap.infisical.leastPrivilegeScopeEvidenceRef = "dashboard-only";
    credentialMap.entries.find((entry: any) => entry.file === "artifact-store-endpoint").source = {
      kind: "secret-backend-ref",
    };
    const token = credentialMap.entries.find((entry: any) => entry.file === "control-plane-token");
    token.rotation = {
      strategy: "later",
      staleAfterDays: -1,
      staleDetectionEvidenceRef: "placeholder",
    };
    token.source.evidenceRef = "evidence://secret-backend/test/control-plane-token";
    token.source.writePlanRef = "placeholder";
    token.source.policyEvidenceRef = "";
    credentialMap.entries = credentialMap.entries.filter(
      (entry: any) => entry.file !== "reviewed-source-known-hosts",
    );
    await fsp.writeFile(credentialMapPath, `${JSON.stringify(credentialMap, null, 2)}\n`, "utf8");
    await fsp.writeFile(path.join(tmp, "credentials", "control-plane-database-url"), "not-url\n");
    await fsp.writeFile(path.join(tmp, "credentials", "control-plane-token"), "\n");
    await fsp.chmod(path.join(tmp, "credentials", "artifact-store-access-key-id"), 0o000);

    const result = await runCredentialPreflight({
      bundleDir: tmp,
      credentialDirectory: path.join(tmp, "credentials"),
      env: { AWS_ACCESS_KEY_ID: "ambient" },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /ambient credential.*AWS_ACCESS_KEY_ID/);
    assert.match(result.errors.join("\n"), /reviewed-source mode does not match/);
    assert.match(result.errors.join("\n"), /stale: old-staging/);
    assert.match(result.errors.join("\n"), /env:DATABASE_URL is env-var-only/);
    assert.match(result.errors.join("\n"), /credential map missing reviewed-source-known-hosts/);
    assert.match(result.errors.join("\n"), /database URL evidence does not match Supabase profile/);
    assert.match(result.errors.join("\n"), /database URL hostname evidence is required/);
    assert.match(result.errors.join("\n"), /reviewed-source evidence is required/);
    assert.match(result.errors.join("\n"), /Infisical requiredSecretNamePlanRef evidence/);
    assert.match(result.errors.join("\n"), /Infisical leastPrivilegeScopeEvidenceRef evidence/);
    assert.match(result.errors.join("\n"), /artifact-store-endpoint.*secret backend ref/);
    assert.match(result.errors.join("\n"), /artifact-store-endpoint.*source evidence/);
    assert.match(result.errors.join("\n"), /artifact-store-endpoint.*least-privilege scope/);
    assert.match(result.errors.join("\n"), /control-plane-token.*rotation strategy/);
    assert.match(result.errors.join("\n"), /control-plane-token.*rotation plan/);
    assert.match(result.errors.join("\n"), /control-plane-token.*stale credential detection/);
    assert.match(result.errors.join("\n"), /control-plane-token.*write plan is incomplete/);
    assert.match(result.errors.join("\n"), /control-plane-token.*source evidence/);
    assert.match(result.errors.join("\n"), /artifact-store-secret-access-key/);
    assert.match(result.errors.join("\n"), /artifact-store-access-key-id.*unreadable/);
    assert.match(result.errors.join("\n"), /control-plane-token.*empty/);
    assert.match(result.errors.join("\n"), /control-plane-database-url.*valid URL/);
    assert.doesNotMatch(result.errors.join("\n"), /ambient.*secret|not-url:\/\/secret/);
  });
});

async function writeFixture(dir: string, setupInput: CloudControlSetupInput): Promise<void> {
  const bundle = renderCloudControlSetupBundle({ ...setupInput, outDir: dir });
  for (const [name, content] of Object.entries(bundle.files)) {
    const filePath = path.join(dir, name);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, content, "utf8");
  }
  const credentials = path.join(dir, "credentials");
  await fsp.mkdir(credentials, { recursive: true });
  const manifest = JSON.parse(bundle.files["credential-manifest.json"]!);
  for (const file of manifest.requiredFiles) {
    await fsp.writeFile(path.join(credentials, file), valueFor(file), "utf8");
  }
}

function valueFor(file: string): string {
  if (file === "control-plane-database-url") return "postgres://user:pass@db.example.test/app\n";
  if (file === "artifact-store-endpoint") return "https://s3.example.test\n";
  return `${file}-value\n`;
}

function input(overrides: Partial<CloudControlSetupInput> = {}): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "aws-ec2",
    image: DIGEST_REF,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: {
      image: DIGEST_REF,
      sourceRevision: "source-review",
      imageBuildIdentity: BUILD_IDENTITY,
      digest: DIGEST,
      inspectedDigest: DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-review",
      evidenceSource: "generated-command",
      registryProfile: ecrRegistryProfileForImage(DIGEST_REF, DIGEST),
    },
    instanceId: "cloud-review",
    publicUrl: "https://deploy.example.test",
    artifactBucket: "deployment-control-plane-artifacts",
    artifactRegion: "us-east-1",
    artifactBackend: "aws-s3",
    artifactBackendEvidence: "",
    deploymentIds: ["pleomino-staging"],
    reviewedSourceMode: "ssh",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    awsTopology: topologyForImage(),
    supabasePostgres: privateLinkSupabaseProfile(),
    runtimeInput: runtimeInput(overrides.artifactCredentialMode || "files"),
    ...overrides,
  };
}

function runtimeInput(artifactCredentialMode: string) {
  return defaultReviewedRuntimeInput({
    publicUrl: "https://deploy.example.test",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    deploymentIds: ["pleomino-staging"],
    supabaseProjectRef: "project-review",
    supabaseConnectionMode: "privatelink",
    awsAccountId: "123456789012",
    awsRegion: "us-east-1",
    awsVpcId: "vpc-123",
    artifactCredentialMode,
  });
}

function topologyForImage() {
  return topologyForPublishedImage(privateLinkAwsTopology(), DIGEST_REF, DIGEST);
}
