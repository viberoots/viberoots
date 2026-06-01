#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { directAwsMutationErrors } from "../../deployments/cloud-control-aws-mutation-scan";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { validateProviderCapabilityHookEvidenceShape } from "../../deployments/cloud-control-provider-capability-hook-contract";
import { publicAwsTopology } from "./cloud-control-cutover-fixture";
import { awsEc2HookProfile } from "./cloud-control-aws-ec2-hook-profile.fixture";
import { asgIac } from "./cloud-control-aws-ec2-asg.fixture";

test("direct AWS mutation scanner rejects hyphenated and tokenized EC2, ASG, IAM, and SG commands", () => {
  const cases: unknown[] = [
    "aws autoscaling create-auto-scaling-group",
    "aws autoscaling create auto scaling group",
    ["aws", "autoscaling", "update-auto-scaling-group"],
    ["aws", "autoscaling", "update auto scaling group"],
    "aws ec2 create-launch-template",
    "aws ec2 create launch template",
    ["aws", "ec2", "modify-launch-template"],
    ["aws", "ec2", "modify launch template"],
    "aws ec2 run-instances",
    "aws ec2 run instances",
    ["aws", "ec2", "terminate-instances"],
    ["aws", "ec2", "terminate instances"],
    "aws ec2 create-security-group",
    ["aws", "ec2", "authorize-security-group-ingress"],
    ["aws", "ec2", "revoke security group egress"],
    "aws iam create-instance-profile",
    "aws iam delete-instance-profile",
    "aws iam delete instance profile",
    "aws iam tag-instance-profile",
    "aws iam tag instance profile",
    "aws iam untag-instance-profile",
    "aws iam untag instance profile",
    "aws iam update-role",
    "aws iam update role",
    "aws iam tag-role",
    "aws iam tag role",
    "aws iam untag-role",
    "aws iam untag role",
    "aws iam add-role-to-instance-profile",
    "aws iam delete-role-policy",
    "aws iam delete role policy",
    "aws iam add role to instance profile",
    "aws iam remove-role-from-instance-profile",
    "aws iam remove role from instance profile",
    "aws iam attach-role-policy",
    "aws iam attach role policy",
    "aws iam detach-role-policy",
    "aws iam detach role policy",
    "aws iam put-role-permissions-boundary",
    "aws iam put role permissions boundary",
    "aws iam delete-role-permissions-boundary",
    "aws iam delete role permissions boundary",
    "aws iam create-policy",
    "aws iam create policy",
    "aws iam delete-policy",
    "aws iam delete policy",
    "aws iam tag-policy",
    "aws iam tag policy",
    "aws iam untag-policy",
    "aws iam untag policy",
    "aws iam create-policy-version",
    "aws iam create policy version",
    "aws iam delete-policy-version",
    "aws iam delete policy version",
    "aws iam set-default-policy-version",
    "aws iam set default policy version",
    "aws iam update-assume-role-policy",
    "aws iam update assume role policy",
  ];
  for (const command of cases) {
    assert.match(
      directAwsMutationErrors("aws-ec2-control-plane-host", { command }).join("\n"),
      /direct AWS mutation command/,
      JSON.stringify(command),
    );
  }
});

test("external-reviewed-host rejects accidental repo-owned ASG evidence and boundaries", async () => {
  const hook = await runCloudProviderCapabilityHook({
    capabilityId: "aws-ec2-control-plane-host",
    phase: "evidence",
    deploymentLabel: "//deployments:staging",
    awsTopologyEvidence: publicAwsTopology(),
    awsEc2Profile: awsEc2HookProfile(),
    expectedEc2HostMode: "external-reviewed-host",
  });
  const withIac = {
    ...hook,
    providerPayload: { ...(hook.providerPayload as any), iac: asgIac() },
  };
  assert.match(
    validateProviderCapabilityHookEvidenceShape(hook.capabilityId, withIac as any, {
      allowedPhases: ["evidence"],
      expectedAwsTopology: publicAwsTopology(),
      expectedEc2HostMode: "external-reviewed-host",
    }).join("\n"),
    /external-reviewed-host must not include repo-owned ASG IaC evidence/,
  );
  const withRepoBoundary = {
    ...hook,
    providerPayload: {
      ...(hook.providerPayload as any),
      provisioningBoundary: "declarative-opentofu-owned-asg",
      mutationAuthority: "opentofu-only",
      operation: {
        ...(hook.providerPayload as any).operation,
        mutationAuthority: "opentofu-only",
      },
    },
  };
  assert.match(
    validateProviderCapabilityHookEvidenceShape(hook.capabilityId, withRepoBoundary as any, {
      allowedPhases: ["evidence"],
      expectedAwsTopology: publicAwsTopology(),
      expectedEc2HostMode: "external-reviewed-host",
    }).join("\n"),
    /external-reviewed-host must remain non-mutating/,
  );
});
