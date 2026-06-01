#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("guide documents EC2 host adapter boundary and generated inputs", async () => {
  const guide = await fsp.readFile("docs/control-plane-guide.md", "utf8");
  assert.match(guide, /non-mutating structured EC2 host adapter/);
  assert.match(
    guide,
    /does not create or update EC2 instances, launch templates, or Auto Scaling groups/,
  );
  assert.match(guide, /selected AWS topology evidence and generated host profile/);
  assert.match(guide, /--aws-topology-evidence/);
  assert.match(guide, /aws-topology-evidence\.json/);
  assert.match(guide, /aws-ec2-profile\.yaml/);
  assert.match(guide, /provider-capability-aws-ec2-control-plane-host\.json/);
});

test("guide documents implemented instance-profile and reviewed-source mode credential contracts", async () => {
  const guide = await fsp.readFile("docs/control-plane-guide.md", "utf8");
  const setup = await fsp.readFile("docs/cloud-control-setup.md", "utf8");
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
