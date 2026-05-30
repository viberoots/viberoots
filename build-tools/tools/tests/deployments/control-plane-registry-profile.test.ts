#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  registryProfileSummary,
  validateControlPlaneRegistryProfile,
} from "../../deployments/control-plane-registry-profile";
import { ecrRegistryProfile, runtimePullProof } from "./control-plane-registry-profile.fixture";

test("registry profile validates AWS ECR provisioning evidence", () => {
  const profile = ecrRegistryProfile();
  assert.deepEqual(validateControlPlaneRegistryProfile(profile), []);
  assert.deepEqual(registryProfileSummary(profile), {
    mode: "aws-ecr",
    repository: profile.repository,
    identity: profile.identity,
    immutability: "immutable-tags",
    lifecyclePolicy: "configured",
    scanning: "enabled",
    runtimePull: {
      principal: profile.runtimePull.principal,
      credentialSource: "ec2-instance-profile",
    },
    publishPrincipal: profile.publish.principal,
    checkedAt: profile.checkedAt,
  });
});

test("registry profile accepts imported registries with equivalent reviewed proof", () => {
  const profile = ecrRegistryProfile({
    mode: "imported",
    repository: "registry.example.com/platform/deployment-control-plane",
    identity: { reviewedReference: "security-review/registry-import-2026-05-30" },
    scanning: {
      status: "reviewed-exception",
      exceptionId: "REG-42",
      reviewedBy: "platform-security",
      reason: "registry exposes vulnerability feed outside ECR scan-on-push",
    },
    runtimePull: {
      principal: "deployment-control-plane-runtime-reader",
      credentialSource: "reviewed-registry-credential-source",
      evidence: "read-only robot account scoped to repository pulls",
      proof: runtimePullProof(
        `registry.example.com/platform/deployment-control-plane@sha256:${"d".repeat(64)}`,
        `sha256:${"d".repeat(64)}`,
        "deployment-control-plane-runtime-reader",
      ),
    },
  });
  assert.deepEqual(validateControlPlaneRegistryProfile(profile), []);
});

test("registry profile rejects mutable policy, missing pull proof, shared push identity, and auth output", () => {
  const errors = validateControlPlaneRegistryProfile(
    ecrRegistryProfile({
      immutability: { status: "mutable" as any, evidence: "" },
      lifecyclePolicy: { status: "configured", evidence: "", ruleCount: 0 },
      scanning: { status: "enabled", evidence: "" },
      runtimePull: {
        principal: "same-principal",
        credentialSource: "reviewed-registry-credential-source",
        evidence: "",
        proof: runtimePullProof("registry.example.com/app@sha256:bad", "sha256:bad"),
      },
      publish: { principal: "same-principal", evidence: "Authorization: Bearer abc123" },
    }),
  ).join("\n");
  assert.match(errors, /immutable tag policy/);
  assert.match(errors, /lifecycle policy/);
  assert.match(errors, /enabled image scanning evidence/);
  assert.match(errors, /runtime pull permission/);
  assert.match(errors, /separate runtime pull and publish/);
  assert.match(errors, /EC2 instance-profile/);
  assert.match(errors, /unsafe credential content/);
});

test("registry profile rejects missing runtime pull proof", () => {
  const profile = ecrRegistryProfile({
    runtimePull: {
      ...ecrRegistryProfile().runtimePull,
      proof: undefined as any,
    },
  });
  const errors = validateControlPlaneRegistryProfile(profile).join("\n");
  assert.match(errors, /requires runtime pull proof/);
});

test("registry profile runtime pull proof must match selected image digest", () => {
  const errors = validateControlPlaneRegistryProfile(ecrRegistryProfile(), {
    expectedImageRef: `123456789012.dkr.ecr.us-east-1.amazonaws.com/deployment-control-plane@sha256:${"e".repeat(64)}`,
    expectedDigest: `sha256:${"e".repeat(64)}`,
    expectedHostProfile: "aws-ec2",
  }).join("\n");
  assert.match(errors, /runtime pull proof image does not match/);
  assert.match(errors, /runtime pull proof digest does not match/);
});
