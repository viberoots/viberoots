#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateProtectedSharedProfileReadiness } from "../../deployments/cloud-control-setup-profile-validate";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { privateLinkAwsTopology } from "./cloud-control-cutover-fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const DIGEST = `sha256:${"d".repeat(64)}`;
const BUILD_IDENTITY = `nix-source-${"e".repeat(64)}`;

function input(overrides: Partial<CloudControlSetupInput> = {}): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "compose-podman",
    image: DIGEST_REF,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: publicationEvidence(),
    instanceId: "cloud-review",
    publicUrl: "https://deploy.example.test",
    artifactBucket: "deployment-control-plane-artifacts",
    artifactRegion: "us-east-1",
    artifactBackend: "aws-s3",
    artifactBackendEvidence: "",
    deploymentIds: ["pleomino-staging", "pleomino-prod"],
    reviewedSourceMode: "ssh",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    awsTopology: privateLinkAwsTopology(),
    supabasePostgres: privateLinkSupabaseProfile(),
    runtimeInput: reviewedRuntimeInput({
      deploymentIds: ["pleomino-staging", "pleomino-prod"],
    }),
    ...overrides,
  };
}

function publicationEvidence() {
  return {
    image: DIGEST_REF,
    sourceRevision: "source-readiness",
    imageBuildIdentity: BUILD_IDENTITY,
    digest: DIGEST,
    inspectedDigest: DIGEST,
    tag: "registry.example.com/platform/deployment-control-plane:source-readiness",
  };
}

test("protected readiness requires paired Infisical id and secret for every config deployment", () => {
  const files = renderCloudControlSetupBundle(input()).files;
  assert.deepEqual(validateProtectedSharedProfileReadiness(files), []);

  assert.match(
    validateProtectedSharedProfileReadiness(
      withRequiredFiles(files, [
        "pleomino-staging-infisical-client-secret",
        "pleomino-prod-infisical-client-secret",
      ]),
    ).join("\n"),
    /missing pleomino-staging-infisical-client-id.*missing pleomino-prod-infisical-client-id/s,
  );

  assert.match(
    validateProtectedSharedProfileReadiness(
      withRequiredFiles(files, [
        "pleomino-staging-infisical-client-id",
        "pleomino-prod-infisical-client-id",
      ]),
    ).join("\n"),
    /missing pleomino-staging-infisical-client-secret.*missing pleomino-prod-infisical-client-secret/s,
  );
});

test("protected readiness rejects Infisical manifest deployment ids that do not match config", () => {
  const files = renderCloudControlSetupBundle(input()).files;
  assert.match(
    validateProtectedSharedProfileReadiness(
      withRequiredFiles(files, [
        "pleomino-staging-infisical-client-id",
        "pleomino-staging-infisical-client-secret",
        "other-prod-infisical-client-id",
        "other-prod-infisical-client-secret",
      ]),
    ).join("\n"),
    /missing pleomino-prod-infisical-client-id.*unexpected other-prod-infisical-client-id/s,
  );
});

test("protected readiness rejects incomplete profiles that self-mark ready", () => {
  const files = renderCloudControlSetupBundle(input({ mode: "saas-oci" })).files;
  files["saas-oci-profile.yaml"] = files["saas-oci-profile.yaml"]!.replace(
    "protectedSharedReady: false",
    "protectedSharedReady: true",
  );
  assert.match(
    validateProtectedSharedProfileReadiness(files).join("\n"),
    /cannot be marked protected\/shared-ready.*must not self-mark protectedSharedReady/s,
  );
});

test("compose profile validation requires runtime ownership semantics", () => {
  const files = renderCloudControlSetupBundle(input()).files;
  assert.match(
    validateProtectedSharedProfileReadiness({
      ...files,
      "compose.yaml": files["compose.yaml"]!.replace('    user: "10001:10001"\n', "").replace(
        "    - /var/lib/deployment-control-plane/runtime\n",
        "",
      ),
    }).join("\n"),
    /compose ownership missing .*deployment-control-plane-service must run as 10001:10001/s,
  );
});

function withRequiredFiles(
  files: Record<string, string>,
  infisicalFiles: string[],
): Record<string, string> {
  const manifest = JSON.parse(files["credential-manifest.json"]!);
  manifest.requiredFiles = [
    "control-plane-database-url",
    "control-plane-token",
    "artifact-store-endpoint",
    "artifact-store-access-key-id",
    "artifact-store-secret-access-key",
    "reviewed-source-ssh-key",
    "reviewed-source-known-hosts",
    ...infisicalFiles,
  ];
  return { ...files, "credential-manifest.json": `${JSON.stringify(manifest, null, 2)}\n` };
}
