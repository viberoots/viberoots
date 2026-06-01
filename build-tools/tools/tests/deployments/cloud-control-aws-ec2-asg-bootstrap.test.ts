#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import YAML from "yaml";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { ec2HostProfileInput } from "./cloud-control-aws-ec2-host-profile.fixture";
import { asgTopology } from "./cloud-control-aws-ec2-asg.fixture";

const FORBIDDEN_SECRET_MATERIAL =
  /DATABASE_URL|postgres(?:ql)?:\/\/|control-plane-token|bearer\s+\S+|aws_access_key_id|aws_secret_access_key|artifact-store-access-key|artifact-store-secret-key|BEGIN [A-Z ]*PRIVATE KEY|private_key|client_secret|infisical-client-secret/i;

test("repo-owned ASG bootstrap artifact resolves from bundle root without secret material", async () => {
  const bundle = renderCloudControlSetupBundle(
    ec2HostProfileInput({ ec2HostMode: "repo-owned-asg", awsTopology: asgTopology() as any }),
  );
  const tfvars = JSON.parse(bundle.files["ec2-asg-opentofu.tfvars.json"]!);
  const bootstrapPath = tfvars.ec2_user_data_path;
  assert.equal(bootstrapPath, "$PROFILE_ROOT/ec2-asg-bootstrap-user-data.sh");
  assert.equal(bundle.files["ec2-asg-bootstrap-user-data.sh"], decodedUserData(tfvars));
  assert.doesNotMatch(bundle.files["ec2-asg-bootstrap-user-data.sh"]!, FORBIDDEN_SECRET_MATERIAL);
  assert.doesNotMatch(bundle.files["ec2-asg-opentofu.tfvars.json"]!, FORBIDDEN_SECRET_MATERIAL);

  const profile = YAML.parse(bundle.files["aws-ec2-profile.yaml"]!);
  assert.equal(profile.compute.bootstrapDigest, tfvars.ec2_user_data_digest);

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "ec2-asg-bootstrap-"));
  await fsp.writeFile(path.join(root, "ec2-asg-bootstrap-user-data.sh"), decodedUserData(tfvars));
  const resolved = path.join(root, bootstrapPath.replace("$PROFILE_ROOT/", ""));
  assert.match(await fsp.readFile(resolved, "utf8"), /^#!\/usr\/bin\/env bash/);
  assert.equal(spawnSync("bash", ["-n", resolved]).status, 0);
});

test("repo-owned ASG runbook treats bootstrap artifact as a bundle-root input", () => {
  const bundle = renderCloudControlSetupBundle(
    ec2HostProfileInput({ ec2HostMode: "repo-owned-asg", awsTopology: asgTopology() as any }),
  );
  const commands = JSON.parse(bundle.files["commands.json"]!);
  const managed = commands.phases.find((phase: any) => phase.id === "managed-dependencies");
  const plan = managed.commands.find((entry: any) => entry.id === "ec2-asg-opentofu-plan");
  assert.ok(plan.inputs.includes("$PROFILE_ROOT/ec2-asg-bootstrap-user-data.sh"));
  assert.match(plan.command, /test -f "\$PROFILE_ROOT\/ec2-asg-bootstrap-user-data\.sh"/);
});

function decodedUserData(tfvars: Record<string, string>): string {
  return Buffer.from(tfvars.ec2_user_data_base64, "base64").toString("utf8");
}
