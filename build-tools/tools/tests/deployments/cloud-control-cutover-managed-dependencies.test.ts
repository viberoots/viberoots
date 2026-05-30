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
