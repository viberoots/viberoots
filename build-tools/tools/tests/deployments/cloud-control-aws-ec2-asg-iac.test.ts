#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import YAML from "yaml";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { validateProviderCapabilityHookEvidenceShape } from "../../deployments/cloud-control-provider-capability-hook-contract";
import { validateEc2AsgIacBundle } from "../../deployments/cloud-control-aws-ec2-asg-iac-evidence";
import { ec2HostProfileInput } from "./cloud-control-aws-ec2-host-profile.fixture";
import { asgIac, asgTopology } from "./cloud-control-aws-ec2-asg.fixture";
import { IMAGE_BUILD_IDENTITY } from "./cloud-control-aws-topology.fixture";
import { viberootsRepoPath } from "./deployment-command";

test("repo-owned ASG resources and runbook commands are explicit opt-in", () => {
  const defaultBundle = renderCloudControlSetupBundle(ec2HostProfileInput());
  assert.equal(defaultBundle.files["ec2-asg-opentofu.tfvars.json"], undefined);
  assert.deepEqual(
    YAML.parse(defaultBundle.files["aws-ec2-profile.yaml"]!).ec2HostMode,
    "external-reviewed-host",
  );

  const bundle = renderCloudControlSetupBundle(
    ec2HostProfileInput({ ec2HostMode: "repo-owned-asg", awsTopology: asgTopology() as any }),
  );
  const commands = JSON.parse(bundle.files["commands.json"]!);
  const managed = commands.phases.find((phase: any) => phase.id === "managed-dependencies");
  const plan = managed.commands.find((entry: any) => entry.id === "ec2-asg-opentofu-plan");
  const apply = managed.commands.find((entry: any) => entry.id === "ec2-asg-opentofu-apply");
  const readonly = managed.commands.find((entry: any) => entry.id === "ec2-asg-readonly-evidence");
  assert.match(plan.command, /tofu -chdir="\$PROFILE_ROOT\/opentofu\/aws-ec2-asg" plan/);
  assert.match(plan.command, /-backend-config="\$PROFILE_ROOT\/ec2-asg-backend\.hcl"/);
  assert.match(plan.command, /-var-file="\$PROFILE_ROOT\/ec2-asg-opentofu\.tfvars\.json"/);
  assert.doesNotMatch(JSON.stringify([plan, apply, readonly]), /-backend=false/);
  const tfvars = JSON.parse(bundle.files["ec2-asg-opentofu.tfvars.json"]!);
  assert.equal(tfvars.ec2_ami_build_identity, IMAGE_BUILD_IDENTITY);
  assert.equal(tfvars.ec2_ami_evidence_path, "sha256:nixos-ami-import");
  assert.ok(plan.outputs.includes("$PROFILE_ROOT/ec2-asg-opentofu-plan.json"));
  assert.ok(apply.outputs.includes("$PROFILE_ROOT/ec2-asg-opentofu-apply.json"));
  assert.ok(readonly.outputs.includes("$PROFILE_ROOT/ec2-asg-readonly-evidence.json"));
  const provider = managed.commands.find(
    (entry: any) => entry.id === "provider-capability-aws-ec2-control-plane-host",
  );
  assert.match(provider.command, /--ec2-host-mode repo-owned-asg/);
  assert.match(
    provider.command,
    /--ec2-asg-opentofu-plan "\$PROFILE_ROOT\/ec2-asg-opentofu-plan\.json"/,
  );
  assert.deepEqual(YAML.parse(bundle.files["aws-ec2-profile.yaml"]!).ec2HostMode, "repo-owned-asg");
});

test("OpenTofu ASG module declares reviewed host controls behind ec2_host_mode", async () => {
  const ec2Host = await fsp.readFile(
    viberootsRepoPath("build-tools/deployments/aws-control-plane-foundation/opentofu/ec2-host.tf"),
    "utf8",
  );
  const vars = await fsp.readFile(
    viberootsRepoPath(
      "build-tools/deployments/aws-control-plane-foundation/opentofu/variables-ec2-host.tf",
    ),
    "utf8",
  );
  assert.match(ec2Host, /local\.ec2_repo_owned_asg/);
  assert.match(ec2Host, /aws_launch_template/);
  assert.match(ec2Host, /aws_autoscaling_group/);
  assert.match(ec2Host, /http_tokens\s+=\s+"required"/);
  assert.match(ec2Host, /encrypted\s+=\s+true/);
  assert.match(ec2Host, /workerPlacement/);
  assert.match(ec2Host, /ssm-no-standing-ssh/);
  assert.match(ec2Host, /logSink/);
  assert.match(ec2Host, /alarmPosture/);
  assert.match(ec2Host, /launch-template-version-rollback/);
  assert.match(vars, /ec2_instance_type/);
  assert.match(vars, /ec2_ami_build_identity[\s\S]*ec2_ami_evidence_path/);
  assert.match(ec2Host, /amiBuildIdentity[\s\S]*amiEvidencePath/);
  assert.match(vars, /ec2_import_adoption_metadata/);
});

test("repo-owned ASG provider evidence rejects direct mutation commands and mode drift", async () => {
  const iac = asgIac();
  const hook = await runCloudProviderCapabilityHook({
    capabilityId: "aws-ec2-control-plane-host",
    phase: "evidence",
    deploymentLabel: "//deployments:staging",
    awsTopologyEvidence: asgTopology() as any,
    awsEc2Profile: YAML.parse(
      renderCloudControlSetupBundle(
        ec2HostProfileInput({ ec2HostMode: "repo-owned-asg", awsTopology: asgTopology() as any }),
      ).files["aws-ec2-profile.yaml"]!,
    ),
    expectedEc2HostMode: "repo-owned-asg",
    ec2AsgIac: iac,
  });
  assert.equal(hook.providerPayload?.ec2HostMode, "repo-owned-asg");
  assert.match(
    validateProviderCapabilityHookEvidenceShape(hook.capabilityId, hook as any, {
      allowedPhases: ["evidence"],
      expectedAwsTopology: asgTopology(),
      expectedEc2HostMode: "external-reviewed-host",
    }).join("\n"),
    /EC2 host mode does not match/,
  );
  assert.match(
    validateProviderCapabilityHookEvidenceShape(
      hook.capabilityId,
      { ...hook, checkedAt: "2000-01-01T00:00:00.000Z" } as any,
      {
        allowedPhases: ["evidence"],
        expectedAwsTopology: asgTopology(),
        expectedEc2HostMode: "repo-owned-asg",
      },
    ).join("\n"),
    /provider-capability evidence is missing or stale/,
    "stale provider evidence",
  );
  const mutated = structuredClone(hook as any);
  mutated.providerPayload.operation.commandTemplates = [
    ["aws", "autoscaling", "create-auto-scaling-group"],
  ];
  assert.match(
    validateProviderCapabilityHookEvidenceShape(hook.capabilityId, mutated, {
      allowedPhases: ["evidence"],
      expectedAwsTopology: asgTopology(),
      expectedEc2HostMode: "repo-owned-asg",
    }).join("\n"),
    /direct AWS mutation command/,
  );
});

test("repo-owned ASG IaC evidence names required drift failures", () => {
  const base = asgIac();
  const cases = [
    ["mismatched AMI", "amiId does not match", { expected: { amiId: "ami-drift" } }],
    [
      "mismatched AMI build identity",
      "amiBuildIdentity does not match",
      { expected: { amiBuildIdentity: `nix-source-${"a".repeat(64)}` } },
    ],
    [
      "mismatched AMI evidence path",
      "amiEvidencePath does not match",
      { expected: { amiEvidencePath: "sha256:other-import" } },
    ],
    [
      "mismatched launch-template version",
      "launchTemplateVersion does not match",
      { expected: { launchTemplateVersion: "8" } },
    ],
    [
      "mismatched ASG name",
      "autoScalingGroupName does not match",
      { expected: { autoScalingGroupName: "other-asg" } },
    ],
    [
      "mismatched instance profile",
      "instanceProfileArn does not match",
      { expected: { instanceProfileArn: "arn:aws:iam::123456789012:instance-profile/other" } },
    ],
    [
      "mismatched subnet",
      "privateSubnetIds does not match",
      { expected: { privateSubnetIds: ["subnet-other"] } },
    ],
    [
      "mismatched security group",
      "securityGroupIds does not match",
      { expected: { securityGroupIds: ["sg-other"] } },
    ],
    [
      "mismatched bootstrap digest",
      "userDataDigest does not match",
      { expected: { userDataDigest: "sha256:other" } },
    ],
    ["mismatched worker count", "reviewed worker placement", { expected: { workerReplicas: 1 } }],
    ["mismatched log sink", "log sink", { observability: { logSink: "none" } }],
    ["mismatched alarm posture", "alarm posture", { observability: { alarmPosture: "missing" } }],
    [
      "mismatched rollback evidence",
      "non-destructive rollback",
      { rollback: { nonDestructive: false } },
    ],
  ] as const;
  for (const [label, expected, override] of cases) {
    const iac = { ...base, readOnly: merge(base.readOnly!, override) };
    expectAsgError(iac, "evidence", expected, label);
  }
  for (const [phase, key] of [
    ["preview", "plan"],
    ["apply", "apply"],
    ["evidence", "readOnly"],
  ] as const) {
    const iac = { ...base, [key]: merge(base[key]!, { expected: { amiEvidencePath: "bad" } }) };
    expectAsgError(iac, phase, "amiEvidencePath does not match", `${key} AMI evidence mismatch`);
  }
});

test("repo-owned ASG import adoption requires metadata and read-only evidence", () => {
  const iac = asgIac({
    plan: merge(asgIac().plan!, {
      importAdoption: { mode: "imported", reviewedReference: "" },
    }),
  });
  const opts = {
    topology: asgTopology() as any,
    profile: profile(),
    expectedMode: "repo-owned-asg" as const,
  };
  assert.match(
    validateEc2AsgIacBundle({ iac, phase: "preview", ...opts }).join("\n"),
    /import requires reviewed import reference/,
  );
  assert.match(
    validateEc2AsgIacBundle({
      iac: { plan: asgIac().plan, apply: asgIac().apply },
      phase: "evidence",
      ...opts,
    }).join("\n"),
    /read-only evidence/,
  );
});

function profile() {
  return YAML.parse(
    renderCloudControlSetupBundle(
      ec2HostProfileInput({ ec2HostMode: "repo-owned-asg", awsTopology: asgTopology() as any }),
    ).files["aws-ec2-profile.yaml"]!,
  );
}

function expectAsgError(iac: any, phase: string, expected: string, label: string) {
  const errors = validateEc2AsgIacBundle({
    iac,
    phase,
    topology: asgTopology() as any,
    profile: profile(),
    expectedMode: "repo-owned-asg",
  }).join("\n");
  assert.match(errors, new RegExp(expected), label);
}

function merge(record: Record<string, any>, override: Record<string, any>) {
  return {
    ...record,
    ...override,
    expected: { ...(record.expected || {}), ...(override.expected || {}) },
    observability: { ...(record.observability || {}), ...(override.observability || {}) },
    rollback: { ...(record.rollback || {}), ...(override.rollback || {}) },
  };
}
