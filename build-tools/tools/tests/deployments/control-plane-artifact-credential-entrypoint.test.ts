#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runDeploymentControlPlaneCommand } from "../../deployments/deployment-control-plane";
import { readCloudControlSetupInput } from "../../deployments/cloud-control-setup";
import { validateCloudControlSetupInput } from "../../deployments/cloud-control-setup-validate";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";

test("deployment-control-plane setup dispatcher treats artifact credential mode as value flag", async () => {
  await withControlPlaneArgv(
    ["setup", "--artifact-credential-mode", "aws-instance-profile", "--help"],
    runDeploymentControlPlaneCommand,
  );
});

test("setup entrypoint rejects instance-profile artifact mode for alternate backends", () => {
  const previous = process.argv;
  try {
    process.argv = [
      "node",
      "deployment-control-plane",
      "setup",
      "--artifact-backend",
      "cloudflare-r2",
      "--artifact-credential-mode",
      "aws-instance-profile",
    ];
    const input = readCloudControlSetupInput();
    assert.equal(input.artifactCredentialMode, "aws-instance-profile");
    assert.equal(input.artifactBackend, "cloudflare-r2");
    assert.match(validateCloudControlSetupInput(input).join("\n"), /requires aws-s3/);
  } finally {
    process.argv = previous;
  }
});
