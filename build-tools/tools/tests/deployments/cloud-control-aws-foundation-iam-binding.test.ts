#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { foundationFromTopology, privateLinkAwsTopology } from "./cloud-control-cutover-fixture";
import { viberootsRepoPath } from "./deployment-command";

const moduleDir = viberootsRepoPath(
  "build-tools/deployments/aws-control-plane-foundation/opentofu",
);

test("OpenTofu foundation attaches artifact policy to EC2 instance-profile role", () => {
  const iam = fs.readFileSync(`${moduleDir}/iam.tf`, "utf8");
  const outputs = fs.readFileSync(`${moduleDir}/outputs.tf`, "utf8");
  assert.doesNotMatch(iam, /resource "aws_iam_role" "s3_artifact_access"/);
  assert.match(
    iam,
    /resource "aws_iam_instance_profile" "ec2_host"[\s\S]*role\s+= aws_iam_role\.ec2_host\.name/,
  );
  assert.match(
    iam,
    /resource "aws_iam_role_policy_attachment" "artifact_access"[\s\S]*role\s+= aws_iam_role\.ec2_host\.name/,
  );
  assert.match(outputs, /s3_artifact_access_role_arn\s+= aws_iam_role\.ec2_host\.arn/);
});

test("foundation profile binds reviewed artifact role to runtime instance profile", () => {
  const foundation = foundationFromTopology(privateLinkAwsTopology());
  const profile = foundation.iam.instanceProfiles?.find(
    (item) => item.arn === "arn:aws:iam::123456789012:instance-profile/control-plane",
  );
  assert.equal(foundation.iam.roles.s3ArtifactAccess, foundation.iam.roles.ec2Host);
  assert.equal(profile?.roleArn, foundation.iam.roles.ec2Host);
  assert.ok(profile?.policyDigests.includes("sha256:artifact-policy"));
});
