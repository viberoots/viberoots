#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";
import { validateEc2AsgIacBundle } from "../../deployments/cloud-control-aws-ec2-asg-iac-evidence";
import { EC2_ASG_OPENTOFU_WORKING_DIR } from "../../deployments/cloud-control-aws-ec2-asg-iac-types";
import { nextCommands } from "../../deployments/cloud-control-setup-command-preview";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateCloudControlSetupInput } from "../../deployments/cloud-control-setup-validate";
import { ec2HostProfileInput } from "./cloud-control-aws-ec2-host-profile.fixture";
import { asgIac, asgTopology } from "./cloud-control-aws-ec2-asg.fixture";

test("repo-owned ASG pre-apply setup renders from desired inputs before live host evidence", () => {
  const input = ec2HostProfileInput({
    ec2HostMode: "repo-owned-asg",
    ec2AsgEvidenceMode: "pre-apply",
    awsTopology: greenfieldAsgTopology() as any,
  });
  assert.deepEqual(validateCloudControlSetupInput(input), []);

  const bundle = renderCloudControlSetupBundle(input);
  assert.ok(bundle.files["ec2-asg-opentofu.tfvars.json"]);
  assert.ok(bundle.files["opentofu/aws-ec2-asg/variables.tf"]);
  assert.equal(bundle.files["opentofu/aws-ec2-asg/network.tf"], undefined);
});

test("repo-owned ASG post-apply setup still requires live ASG and process evidence", () => {
  const errors = validateCloudControlSetupInput(
    ec2HostProfileInput({
      ec2HostMode: "repo-owned-asg",
      ec2AsgEvidenceMode: "post-apply",
      awsTopology: greenfieldAsgTopology() as any,
    }),
  ).join("\n");
  assert.match(errors, /AWS compute evidence missing launch template identity/);
  assert.match(errors, /AWS process evidence missing service process proof/);
  assert.match(errors, /AWS registry runtime pull proof/);
});

test("repo-owned ASG OpenTofu root variables are complete and ASG-specific", () => {
  const bundle = renderCloudControlSetupBundle(
    ec2HostProfileInput({ ec2HostMode: "repo-owned-asg", awsTopology: asgTopology() as any }),
  );
  const tfvars = JSON.parse(bundle.files["ec2-asg-opentofu.tfvars.json"]!);
  const variables = declaredVariables(bundle.files["opentofu/aws-ec2-asg/variables.tf"]!);
  for (const variable of variables) assert.ok(variable in tfvars, `missing ${variable}`);
  assert.equal(bundle.files["opentofu/aws-ec2-asg/network.tf"], undefined);
  assert.equal(bundle.files["opentofu/aws-ec2-asg/ecr.tf"], undefined);
  assert.equal(bundle.files["opentofu/aws-ec2-asg/privatelink.tf"], undefined);

  const commands = JSON.parse(bundle.files["commands.json"]!);
  const managed = commands.phases.find((phase: any) => phase.id === "managed-dependencies");
  const readonly = managed.commands.find((entry: any) => entry.id === "ec2-asg-readonly-evidence");
  assert.match(readonly.command, /\$PROFILE_ROOT\/ec2-asg-opentofu-apply\.out\.json/);
  assert.doesNotMatch(readonly.command, /autoScalingGroupName \|\|/);
  assert.doesNotMatch(JSON.stringify(managed.commands), /-backend=false/);
});

test("repo-owned ASG evidence must use generated ASG-specific OpenTofu root", () => {
  const input = ec2HostProfileInput({
    ec2HostMode: "repo-owned-asg",
    awsTopology: asgTopology() as any,
  });
  const profile = YAML.parse(renderCloudControlSetupBundle(input).files["aws-ec2-profile.yaml"]!);
  assert.deepEqual(
    validateEc2AsgIacBundle({
      iac: asgIac(),
      phase: "preview",
      topology: input.awsTopology,
      profile,
      expectedMode: "repo-owned-asg",
    }),
    [],
  );

  const oldRoot = "$PROFILE_ROOT/opentofu/aws-control-plane-foundation";
  const errors = validateEc2AsgIacBundle({
    iac: asgIac({ plan: { ...asgIac().plan, workingDirectory: oldRoot } }),
    phase: "preview",
    topology: input.awsTopology,
    profile,
    expectedMode: "repo-owned-asg",
  }).join("\n");
  assert.match(errors, /ASG-specific bundle-root OpenTofu working directory/);
  assert.notEqual(oldRoot, EC2_ASG_OPENTOFU_WORKING_DIR);
});

test("repo-owned ASG setup previews preserve explicit host mode", () => {
  const commands = nextCommands(
    ec2HostProfileInput({
      dryRun: true,
      ec2HostMode: "repo-owned-asg",
      ec2AsgEvidenceMode: "pre-apply",
      awsTopology: greenfieldAsgTopology() as any,
    }),
  ).join("\n");
  assert.match(commands, /--ec2-host-mode repo-owned-asg/);
  assert.match(commands, /--ec2-asg-evidence-mode pre-apply/);
});

function greenfieldAsgTopology() {
  const topology = structuredClone(asgTopology() as any);
  delete topology.operationalVisibility;
  delete topology.compute.instanceId;
  delete topology.compute.launchTemplateId;
  delete topology.compute.launchTemplateVersion;
  delete topology.compute.registryPullProof;
  delete topology.compute.processEvidence;
  delete topology.ingress.targetRegistration.instanceId;
  return topology;
}

function declaredVariables(source: string): string[] {
  return [...source.matchAll(/variable "([^"]+)"/g)].map((match) => match[1]!);
}
