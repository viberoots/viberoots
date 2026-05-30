#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateCloudControlSetupInput } from "../../deployments/cloud-control-setup-validate";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { privateLinkAwsTopology } from "./cloud-control-cutover-fixture";

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
    awsTopology: privateLinkAwsTopology(),
    ...overrides,
  };
}

test("AWS EC2 alternate artifact backends require reviewed evidence", () => {
  assert.match(
    validateCloudControlSetupInput(
      input({
        artifactBackend: "supabase-storage-s3",
        awsTopology: privateLinkAwsTopology({
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
          awsTopology: privateLinkAwsTopology({
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
      awsTopology: privateLinkAwsTopology({
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
