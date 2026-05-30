#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { setupInput } from "./control-plane-managed-dependencies-runtime-path.fixture";

test("AWS setup profile renders runtime-path expectations and runbook source-host proof", () => {
  const bundle = renderCloudControlSetupBundle(setupInput());
  const profile = YAML.parse(bundle.files["managed-dependencies.profile.yaml"]!);
  assert.equal(profile.runtimePath.expectedHostProfile, "aws-ec2");
  assert.equal(profile.runtimePath.databaseConnectivityMode, "privatelink");
  assert.equal(profile.runtimePath.expectedPrivateLinkEndpointId, "vpce-privatelink123");
  assert.equal(profile.runtimePath.expectedS3VpcEndpointId, "vpce-123");
  assert.equal(profile.artifactStore.provider, "aws-s3");
  const commands = JSON.parse(bundle.files["commands.json"]!);
  const managed = commands.phases[2].commands[0].command;
  assert.match(managed, /source-host-identity/);
  assert.match(managed, /host-profile "\$RUNTIME_HOST_PROFILE"/);
  assert.match(managed, /aws-region "\$SOURCE_AWS_REGION"/);
  assert.match(managed, /privatelink-endpoint-id 'vpce-privatelink123'/);
  assert.match(managed, /s3-vpc-endpoint-id 'vpce-123'/);
  assert.doesNotMatch(managed, /MANAGED_DEPENDENCY_PRIVATELINK_ENDPOINT_ID/);
  assert.doesNotMatch(managed, /MANAGED_DEPENDENCY_S3_VPC_ENDPOINT_ID/);
  assert.match(managed, /169\.254\.169\.254/);
});
