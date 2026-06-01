#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateCloudControlSetupInput } from "../../deployments/cloud-control-setup-validate";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { defaultReviewedRuntimeInput } from "../../deployments/cloud-control-runtime-input";
import { privateLinkAwsTopology, topologyForPublishedImage } from "./cloud-control-cutover-fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const DIGEST = `sha256:${"c".repeat(64)}`;
const BUILD_IDENTITY = `nix-source-${"d".repeat(64)}`;

function input(overrides: Partial<CloudControlSetupInput> = {}): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "aws-ec2",
    image: DIGEST_REF,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: {
      image: DIGEST_REF,
      sourceRevision: "source-aws-artifact",
      imageBuildIdentity: BUILD_IDENTITY,
      digest: DIGEST,
      inspectedDigest: DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-aws-artifact",
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

test("AWS EC2 alternate artifact backends require reviewed evidence", () => {
  assert.match(
    validateCloudControlSetupInput(
      input({
        artifactBackend: "supabase-storage-s3",
        awsTopology: topologyForImage({
          artifactBackend: "supabase-storage-s3",
          s3VpcEndpoint: undefined,
        }),
      }),
    ).join("\n"),
    /missing reviewed alternate artifact backend evidence/,
  );
  assert.throws(
    () =>
      renderCloudControlSetupBundle(
        input({
          artifactBackend: "s3-compatible",
          awsTopology: topologyForImage({
            artifactBackend: "s3-compatible",
            s3VpcEndpoint: undefined,
          }),
        }),
      ),
    /missing reviewed alternate artifact backend evidence/,
  );
});

test("AWS EC2 alternate artifact backend records reviewed evidence", () => {
  const bundle = renderCloudControlSetupBundle(
    input({
      artifactBackend: "supabase-storage-s3",
      awsTopology: topologyForImage({
        artifactBackend: "supabase-storage-s3",
        s3VpcEndpoint: undefined,
        artifactBackendEvidence: {
          checkedAt: new Date().toISOString(),
          reviewedReference: "reviewed-supabase-storage-s3-endpoint-policy",
          digest: "sha256:alternate-artifact-backend",
        },
      }),
      artifactBackendEvidence: "reviewed-supabase-storage-s3-endpoint-policy",
    }),
  );
  const managed = JSON.parse(bundle.files["managed-dependencies.json"]!);
  assert.equal(managed.artifactStore.backend, "supabase-storage-s3");
  assert.equal(managed.artifactStore.defaultAwsPath, undefined);
  assert.equal(
    managed.artifactStore.reviewedAlternateEvidence,
    "reviewed-supabase-storage-s3-endpoint-policy sha256:alternate-artifact-backend",
  );
  const profile = YAML.parse(bundle.files["aws-ec2-profile.yaml"]!);
  assert.equal(profile.artifactBackend.selected, "supabase-storage-s3");
  assert.equal(
    profile.artifactBackend.reviewedAlternateEvidence,
    "supabase-storage-s3 with evidence reviewed-supabase-storage-s3-endpoint-policy sha256:alternate-artifact-backend",
  );
});

test("AWS EC2 Cloudflare R2 artifact backend remains provider-specific", () => {
  const bundle = renderCloudControlSetupBundle(
    input({
      artifactBackend: "cloudflare-r2",
      awsTopology: topologyForImage({
        artifactBackend: "cloudflare-r2",
        s3VpcEndpoint: undefined,
        artifactBackendEvidence: {
          checkedAt: new Date().toISOString(),
          reviewedReference: "reviewed-cloudflare-r2-endpoint-policy",
          digest: "sha256:cloudflare-r2-artifact-backend",
        },
      }),
      artifactBackendEvidence: "reviewed-cloudflare-r2-endpoint-policy",
    }),
  );
  const profile = YAML.parse(bundle.files["managed-dependencies.profile.yaml"]!);
  assert.equal(profile.artifactStore.provider, "cloudflare-r2");
  assert.equal(
    profile.runtimePath.expectedAlternateBackendEvidenceDigest,
    "sha256:cloudflare-r2-artifact-backend",
  );
});

test("AWS EC2 instance-profile artifact mode renders mode-specific credentials and evidence", () => {
  const bundle = renderCloudControlSetupBundle(
    input({
      artifactCredentialMode: "aws-instance-profile",
      artifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-host",
      artifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
    }),
  );
  const config = YAML.parse(bundle.files["config.yaml"]!);
  assert.equal(config.storage.artifactStore.credentialMode, "aws-instance-profile");
  assert.equal(config.storage.artifactStore.accessKeyIdFile, undefined);
  const manifest = JSON.parse(bundle.files["credential-manifest.json"]!);
  assert.ok(manifest.requiredFiles.includes("artifact-store-endpoint"));
  assert.ok(!manifest.requiredFiles.includes("artifact-store-access-key-id"));
  const managed = YAML.parse(bundle.files["managed-dependencies.profile.yaml"]!);
  assert.equal(managed.artifactStore.credentialMode, "aws-instance-profile");
  assert.equal(
    managed.runtimePath.expectedArtifactLeastPrivilegePolicyDigest,
    "sha256:artifact-policy",
  );
});

test("AWS EC2 instance-profile artifact mode fails closed without IAM evidence", () => {
  assert.match(
    validateCloudControlSetupInput(input({ artifactCredentialMode: "aws-instance-profile" })).join(
      "\n",
    ),
    /requires IAM role ARN/,
  );
  assert.match(
    validateCloudControlSetupInput(
      input({
        artifactCredentialMode: "aws-instance-profile",
        artifactIamRoleArn: "arn:aws:iam::123456789012:role/other",
        artifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
      }),
    ).join("\n"),
    /does not match reviewed foundation role evidence/,
  );
  assert.match(
    validateCloudControlSetupInput(
      input({
        artifactCredentialMode: "aws-instance-profile",
        artifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-host",
        artifactLeastPrivilegePolicyDigest: "sha256:wrong",
      }),
    ).join("\n"),
    /policy digest must reference reviewed least-privilege evidence/,
  );
  assert.match(
    validateCloudControlSetupInput(
      input({
        artifactBackend: "cloudflare-r2",
        artifactCredentialMode: "aws-instance-profile",
      }),
    ).join("\n"),
    /aws-instance-profile requires aws-s3/,
  );
});

function topologyForImage(overrides: Record<string, unknown> = {}) {
  return topologyForPublishedImage(privateLinkAwsTopology(overrides), DIGEST_REF, DIGEST);
}
