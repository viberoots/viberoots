#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCloudControlSetupInput } from "../../deployments/cloud-control-setup-validate";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { privateLinkAwsTopology, topologyForPublishedImage } from "./cloud-control-cutover-fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";

const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const DIGEST = `sha256:${"c".repeat(64)}`;
const BUILD_IDENTITY = `nix-source-${"d".repeat(64)}`;

test("AWS EC2 instance-profile artifact mode rejects unrelated compute profile", () => {
  const reviewedTopology = topologyForImage();
  assert.match(
    validateCloudControlSetupInput(
      input({
        awsTopology: {
          ...reviewedTopology,
          compute: {
            ...(reviewedTopology as any).compute,
            instanceProfileArn: "arn:aws:iam::123456789012:instance-profile/unrelated",
          },
        },
      }),
    ).join("\n"),
    /requires reviewed profile-to-role evidence/,
  );
});

test("AWS EC2 instance-profile artifact mode rejects role and policy binding mismatch", () => {
  const reviewedTopology = topologyForImage();
  assert.match(
    validateCloudControlSetupInput(
      input({ awsTopology: topologyWithProfile(reviewedTopology, "role/other", ["sha256:other"]) }),
    ).join("\n"),
    /instance profile role does not match expected artifact role/,
  );
  assert.match(
    validateCloudControlSetupInput(
      input({
        awsTopology: topologyWithProfile(reviewedTopology, "role/control-plane-artifacts", [
          "sha256:other",
        ]),
      }),
    ).join("\n"),
    /instance profile policy does not include expected artifact policy/,
  );
});

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
    artifactCredentialMode: "aws-instance-profile",
    artifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-artifacts",
    artifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
    artifactBackendEvidence: "",
    deploymentIds: ["pleomino-staging"],
    reviewedSourceMode: "ssh",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    awsTopology: topologyForImage(),
    ...overrides,
  };
}

function topologyWithProfile(topology: any, rolePath: string, policyDigests: string[]) {
  return {
    ...topology,
    foundation: {
      ...topology.foundation,
      iam: {
        ...topology.foundation.iam,
        instanceProfiles: [
          {
            arn: topology.compute.instanceProfileArn,
            roleArn: `arn:aws:iam::123456789012:${rolePath}`,
            trustDigest: "sha256:instance-profile-trust",
            policyDigests,
          },
        ],
      },
    },
  };
}

function topologyForImage(overrides: Record<string, unknown> = {}) {
  return topologyForPublishedImage(privateLinkAwsTopology(overrides), DIGEST_REF, DIGEST);
}
