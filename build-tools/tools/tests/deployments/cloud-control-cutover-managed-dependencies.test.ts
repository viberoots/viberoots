#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import {
  evidence,
  IMAGE_BUILD_IDENTITY,
  managedDependencyEvidence,
} from "./cloud-control-cutover-fixture";

test("cloud cutover rejects stale or incomplete managed dependency evidence", () => {
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const result = validateCloudControlCutover(
    evidence({
      managedDependencies: managedDependencyEvidence({
        checkedAt: stale,
        artifactStore: { checkedOperations: ["PUT"], digest: "" },
      }),
    }),
    {
      operation: "cutover",
      expectedHostProfile: "aws-ec2",
      expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
      expectedRegion: "us-east-1",
      selectedCapabilities: [],
      maxAgeMinutes: 60,
    },
  );
  const errors = result.errors.join("\n");
  assert.match(errors, /managed dependency evidence is missing or stale/);
  assert.match(errors, /artifact-store operation checks/);
  assert.match(errors, /artifact-store digest/);
});

test("cloud cutover rejects public managed dependency evidence for PrivateLink topology", () => {
  const imported = managedDependencyEvidence();
  const result = validateCloudControlCutover(
    evidence({
      managedDependencies: managedDependencyEvidence({
        runtimePath: {
          ...(imported.runtimePath as Record<string, unknown>),
          databaseConnectivityMode: "public",
          privatelinkEndpointId: "vpce-privatelink123",
        },
        postgres: {
          ...(imported.postgres as Record<string, unknown>),
          databaseConnectivityMode: "public",
          resolvedHost: "db.project-review.supabase.co",
          privatelinkEndpointId: "vpce-privatelink123",
        },
      }),
    }),
    {
      operation: "cutover",
      expectedHostProfile: "aws-ec2",
      expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
      expectedRegion: "us-east-1",
      selectedCapabilities: [],
      maxAgeMinutes: 60,
    },
  );
  const errors = result.errors.join("\n");
  assert.match(errors, /database connectivity mode does not match/);
});

test("cloud cutover rejects instance-profile artifact IAM role mismatch", () => {
  const result = validateCloudControlCutover(
    evidence({
      managedDependencies: instanceProfileManagedDependencies({
        expectedArtifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-unused-artifacts",
        observedArtifactIamRoleName: "control-plane-unused-artifacts",
      }),
    }),
    options(),
  );
  assert.match(result.errors.join("\n"), /AWS S3 artifact IAM role does not match expected value/);
});

test("cloud cutover rejects instance-profile artifact policy digest mismatch", () => {
  const result = validateCloudControlCutover(
    evidence({
      managedDependencies: instanceProfileManagedDependencies({
        artifactLeastPrivilegePolicyDigest: "sha256:unused-artifact-policy",
      }),
    }),
    options(),
  );
  assert.match(
    result.errors.join("\n"),
    /AWS S3 least-privilege policy digest does not match expected value/,
  );
});

test("cloud cutover rejects instance-profile artifact evidence with missing credential mode", () => {
  const cutover = cutoverWithInstanceProfileArtifact();
  delete (cutover.managedDependencies as any).artifactStore.artifactCredentialMode;
  const result = validateCloudControlCutover(cutover, options());
  assert.match(
    result.errors.join("\n"),
    /AWS S3 evidence missing aws-instance-profile artifact credential mode/,
  );
});

test("cloud cutover rejects instance-profile artifact evidence with tampered credential mode", () => {
  const cutover = cutoverWithInstanceProfileArtifact();
  (cutover.managedDependencies as any).artifactStore.artifactCredentialMode = "files";
  const result = validateCloudControlCutover(cutover, options());
  assert.match(
    result.errors.join("\n"),
    /AWS S3 evidence missing aws-instance-profile artifact credential mode/,
  );
});

test("cloud cutover rejects missing reviewed runtime instance-profile binding", () => {
  const cutover = cutoverWithInstanceProfileArtifact();
  (cutover.awsTopology as any).foundation.iam.instanceProfiles = [];
  const result = validateCloudControlCutover(cutover, options());
  const errors = result.errors.join("\n");
  assert.match(errors, /missing reviewed runtime instance-profile artifact IAM binding/);
  assert.match(errors, /missing reviewed runtime least-privilege artifact policy binding/);
});

test("cloud cutover rejects stale compute instance-profile binding", () => {
  const cutover = cutoverWithInstanceProfileArtifact();
  (cutover.awsTopology as any).compute.instanceProfileArn =
    "arn:aws:iam::123456789012:instance-profile/unreviewed";
  const result = validateCloudControlCutover(cutover, options());
  assert.match(
    result.errors.join("\n"),
    /missing reviewed runtime instance-profile artifact IAM binding/,
  );
});

test("cloud cutover rejects unused foundation artifact role fallback", () => {
  const cutover = cutoverWithInstanceProfileArtifact({
    expectedArtifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-unused-artifacts",
    observedArtifactIamRoleName: "control-plane-unused-artifacts",
  });
  (cutover.awsTopology as any).foundation.iam.instanceProfiles = [];
  (cutover.awsTopology as any).foundation.iam.roles.s3ArtifactAccess =
    "arn:aws:iam::123456789012:role/control-plane-unused-artifacts";
  const result = validateCloudControlCutover(cutover, options());
  assert.match(
    result.errors.join("\n"),
    /missing reviewed runtime instance-profile artifact IAM binding/,
  );
});

test("cloud cutover rejects missing reviewed artifact policy on runtime profile", () => {
  const cutover = cutoverWithInstanceProfileArtifact();
  const profile = (cutover.awsTopology as any).foundation.iam.instanceProfiles[0];
  profile.policyDigests = [];
  const result = validateCloudControlCutover(cutover, options());
  assert.match(
    result.errors.join("\n"),
    /missing reviewed runtime least-privilege artifact policy binding/,
  );
});

test("cloud cutover rejects missing reviewed least-privilege artifact policy evidence", () => {
  const cutover = cutoverWithInstanceProfileArtifact();
  (cutover.awsTopology as any).foundation.iam.policies = [];
  const result = validateCloudControlCutover(cutover, options());
  assert.match(
    result.errors.join("\n"),
    /missing reviewed runtime least-privilege artifact policy binding/,
  );
});

test("cloud cutover rejects echoed missing reviewed artifact sentinels", () => {
  const cutover = cutoverWithInstanceProfileArtifact({
    expectedArtifactIamRoleArn: "missing-reviewed-instance-profile-artifact-role-binding",
    artifactLeastPrivilegePolicyDigest: "missing-reviewed-instance-profile-artifact-policy-binding",
  });
  (cutover.managedDependencies as any).runtimePath.expectedArtifactIamRoleArn =
    "missing-reviewed-instance-profile-artifact-role-binding";
  (cutover.managedDependencies as any).runtimePath.expectedArtifactLeastPrivilegePolicyDigest =
    "missing-reviewed-instance-profile-artifact-policy-binding";
  (cutover.awsTopology as any).foundation.iam.instanceProfiles = [];
  (cutover.awsTopology as any).foundation.iam.policies = [];
  const result = validateCloudControlCutover(cutover, options());
  const errors = result.errors.join("\n");
  assert.match(errors, /missing reviewed runtime instance-profile artifact IAM binding/);
  assert.match(errors, /missing reviewed runtime least-privilege artifact policy binding/);
});

function cutoverWithInstanceProfileArtifact(artifactOverrides: Record<string, unknown> = {}) {
  return evidence({
    managedDependencies: instanceProfileManagedDependencies(artifactOverrides),
  }) as any;
}

function instanceProfileManagedDependencies(artifactOverrides: Record<string, unknown> = {}) {
  const imported = managedDependencyEvidence();
  return managedDependencyEvidence({
    runtimePath: {
      ...(imported.runtimePath as Record<string, unknown>),
      expectedArtifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-host",
      expectedArtifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
    },
    artifactStore: {
      ...(imported.artifactStore as Record<string, unknown>),
      artifactCredentialMode: "aws-instance-profile",
      expectedArtifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-host",
      observedArtifactIamRoleName: "control-plane-host",
      artifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
      ...artifactOverrides,
    },
  });
}

function options() {
  return {
    operation: "cutover" as const,
    expectedHostProfile: "aws-ec2",
    expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
    expectedRegion: "us-east-1",
    selectedCapabilities: [],
    maxAgeMinutes: 60,
  };
}
