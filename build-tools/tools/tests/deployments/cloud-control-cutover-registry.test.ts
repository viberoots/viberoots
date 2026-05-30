#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import {
  evidence,
  IMAGE_BUILD_IDENTITY,
  imagePublicationEvidence,
} from "./cloud-control-cutover-fixture";
import { runtimePullProof } from "./control-plane-registry-profile.fixture";

const CUTOVER_OPTIONS = {
  operation: "cutover" as const,
  expectedHostProfile: "aws-ec2",
  expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
  selectedCapabilities: [],
  maxAgeMinutes: 60,
};

test("cloud cutover rejects registry runtime pull proof for the wrong digest", () => {
  const base = imagePublicationEvidence();
  const profile = base.registryProfile as any;
  const wrongPullProof = validateCloudControlCutover(
    evidence({
      imagePublication: imagePublicationEvidence({
        registryProfile: {
          ...profile,
          runtimePull: {
            ...profile.runtimePull,
            proof: runtimePullProof(
              `registry.example.com/platform/deployment-control-plane@sha256:${"e".repeat(64)}`,
              `sha256:${"e".repeat(64)}`,
            ),
          },
        },
      }),
    }),
    CUTOVER_OPTIONS,
  );
  assert.match(wrongPullProof.errors.join("\n"), /runtime pull proof image does not match/);
  assert.match(wrongPullProof.errors.join("\n"), /runtime pull proof digest does not match/);
});
