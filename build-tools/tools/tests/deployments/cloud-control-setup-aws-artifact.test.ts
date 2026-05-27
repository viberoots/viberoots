#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateCloudControlSetupInput } from "../../deployments/cloud-control-setup-validate";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";

const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

function input(overrides: Partial<CloudControlSetupInput> = {}): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "aws-ec2",
    image: DIGEST_REF,
    instanceId: "cloud-review",
    publicUrl: "https://deploy.example.test",
    artifactBucket: "deployment-control-plane-artifacts",
    artifactRegion: "us-east-1",
    artifactBackend: "aws-s3",
    artifactBackendEvidence: "",
    reviewedSourceMode: "ssh",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    supabasePrivatelink: false,
    awsVpcEndpoint: true,
    awsSubnetIds: ["subnet-123"],
    awsSecurityGroupIds: ["sg-123"],
    tlsEvidence: "alb-listener-dns-reviewed",
    ...overrides,
  };
}

test("AWS EC2 alternate artifact backends require reviewed evidence", () => {
  assert.match(
    validateCloudControlSetupInput(input({ artifactBackend: "supabase-storage-s3" })).join("\n"),
    /alternate artifact stores require reviewed alternate backend evidence/,
  );
  assert.throws(
    () => renderCloudControlSetupBundle(input({ artifactBackend: "s3-compatible" })),
    /alternate artifact stores require reviewed alternate backend evidence/,
  );
});

test("AWS EC2 alternate artifact backend records reviewed evidence", () => {
  const bundle = renderCloudControlSetupBundle(
    input({
      artifactBackend: "supabase-storage-s3",
      awsVpcEndpoint: false,
      artifactBackendEvidence: "reviewed-supabase-storage-s3-endpoint-policy",
    }),
  );
  const managed = JSON.parse(bundle.files["managed-dependencies.json"]!);
  assert.equal(managed.artifactStore.backend, "supabase-storage-s3");
  assert.equal(managed.artifactStore.defaultAwsPath, undefined);
  assert.equal(
    managed.artifactStore.reviewedAlternateEvidence,
    "reviewed-supabase-storage-s3-endpoint-policy",
  );
  assert.match(
    bundle.files["aws-ec2-profile.md"]!,
    /Selected artifact backend: supabase-storage-s3/,
  );
  assert.match(
    bundle.files["aws-ec2-profile.md"]!,
    /Reviewed alternate artifact evidence: supabase-storage-s3 with evidence reviewed-supabase-storage-s3-endpoint-policy/,
  );
});
