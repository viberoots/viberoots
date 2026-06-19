#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsRepoPath } from "./deployment-command";

test("guide documents EC2 host adapter boundary and generated inputs", async () => {
  const guide = await fsp.readFile(viberootsRepoPath("docs/control-plane-guide.md"), "utf8");
  assert.match(guide, /non-mutating structured EC2 host adapter/);
  assert.match(
    guide,
    /does not create or update EC2 instances, launch templates, or Auto\s+Scaling groups/,
  );
  assert.match(guide, /selected AWS topology evidence and generated host profile/);
  assert.match(guide, /--aws-topology-evidence/);
  assert.match(guide, /aws-topology-evidence\.json/);
  assert.match(guide, /aws-ec2-profile\.yaml/);
  assert.match(guide, /provider-capability-aws-ec2-control-plane-host\.json/);
  assert.match(guide, /external-reviewed-host/);
  assert.match(guide, /repo-owned-asg/);
  assert.match(guide, /platform-team-owned EC2 remains preferable/i);
  assert.match(guide, /pre-apply setup renders the ASG OpenTofu\s+bundle/s);
  assert.match(
    guide,
    /post-apply setup-doctor, readiness, and cutover require live read-only\s+ASG\/EC2 evidence/s,
  );
  assert.match(guide, /launch-template version rollback/);
  assert.match(guide, /worker drain or\s+shutdown proof/);
});

test("guide documents implemented instance-profile and reviewed-source mode credential contracts", async () => {
  const guide = await fsp.readFile(viberootsRepoPath("docs/control-plane-guide.md"), "utf8");
  const setup = await fsp.readFile(viberootsRepoPath("docs/cloud-control-setup.md"), "utf8");
  assert.doesNotMatch(guide, /instance-profile\/IAM-role artifact access.*needs the code work/s);
  assert.match(guide, /aws-instance-profile.*omits artifact access-key and secret-key files/s);
  assert.match(
    guide,
    /SSH mode stages `reviewed-source-ssh-key` and `reviewed-source-known-hosts`/,
  );
  assert.match(guide, /GitHub App mode stages `reviewed-source-github-app-id`/);
  assert.match(setup, /instance-profile mode uses the reviewed EC2 instance profile/s);
  assert.match(setup, /does not stage artifact\s+access-key or secret-key files/);
});

test("guide cutover example includes generated AWS-primary capabilities", async () => {
  const guide = await fsp.readFile(viberootsRepoPath("docs/control-plane-guide.md"), "utf8");
  assert.match(guide, /generated `cutover-validate` command from\s+`commands\.json`/s);
  for (const capability of [
    "aws-ec2-control-plane-host",
    "aws-network-foundation",
    "aws-ecr-control-plane-registry",
    "aws-s3-artifact-store",
    "supabase-managed-postgres",
    "supabase-privatelink-prerequisite",
  ]) {
    assert.match(guide, new RegExp(capability));
  }
});

test("cutover docs do not show a short AWS-primary capability list", async () => {
  const cutover = await fsp.readFile(viberootsRepoPath("docs/cloud-control-cutover.md"), "utf8");
  assert.doesNotMatch(
    cutover,
    /--selected-capability aws-ec2-control-plane-host,aws-s3-artifact-store\b/,
  );
  for (const capability of ["aws-network-foundation", "aws-ecr-control-plane-registry"]) {
    assert.match(cutover, new RegExp(capability));
  }
});
