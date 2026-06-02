import type { AwsTopologyEvidence } from "./cloud-control-aws-topology-types";
import type { Ec2HostMode } from "./cloud-control-aws-ec2-host-mode";
import { amiEvidenceErrors } from "./cloud-control-aws-ec2-asg-ami-evidence";
import {
  userDataIdentityErrors,
  userDataTransitionErrors,
} from "./cloud-control-aws-ec2-asg-user-data-evidence";
import {
  EC2_ASG_APPLY_SCHEMA,
  EC2_ASG_IAC_PATHS,
  EC2_ASG_OPENTOFU_WORKING_DIR,
  EC2_ASG_PLAN_SCHEMA,
  EC2_ASG_READONLY_SCHEMA,
  EC2_ASG_SHA256,
  type Ec2AsgIacBundle,
} from "./cloud-control-aws-ec2-asg-iac-types";
import {
  compareEvidenceField,
  needsEc2AsgApply,
  needsEc2AsgReadOnly,
  recordList,
  recordObject,
  recordText,
  sameEvidenceSet,
  summarizeEc2AsgRecord,
} from "./cloud-control-aws-ec2-asg-iac-helpers";

export { EC2_ASG_IAC_PATHS, type Ec2AsgIacBundle };

export function validateEc2AsgIacBundle(opts: {
  iac: Ec2AsgIacBundle;
  phase: string;
  topology?: AwsTopologyEvidence;
  profile?: Record<string, unknown>;
  expectedMode?: Ec2HostMode;
}) {
  const mode =
    opts.expectedMode && opts.expectedMode !== "repo-owned-asg"
      ? ["EC2 ASG expected host mode must be repo-owned-asg"]
      : [];
  const plan = validatePlan(opts.iac.plan, opts);
  const apply = needsEc2AsgApply(opts.phase)
    ? validateApply(opts.iac.apply, opts.iac.plan, opts)
    : [];
  const readOnly = needsEc2AsgReadOnly(opts.phase)
    ? validateReadOnly(opts.iac.readOnly, opts.iac.apply, opts)
    : [];
  return [...mode, ...plan, ...apply, ...readOnly];
}

export function ec2AsgEvidenceSummary(iac: Ec2AsgIacBundle) {
  return {
    plan: summarizeEc2AsgRecord(iac.plan),
    apply: summarizeEc2AsgRecord(iac.apply),
    readOnly: summarizeEc2AsgRecord(iac.readOnly),
  };
}

function validatePlan(value: unknown, opts: ExpectedInputs) {
  const plan = recordObject(value);
  const errors = common("plan", plan, EC2_ASG_PLAN_SCHEMA, EC2_ASG_IAC_PATHS.plan);
  if (recordText(plan, "source") !== "reviewed-opentofu-plan") {
    errors.push("EC2 ASG IaC plan must come from reviewed OpenTofu plan");
  }
  errors.push(...identityErrors("plan", plan, opts));
  errors.push(...postureErrors("plan", plan, opts));
  const adoption = recordObject(plan.importAdoption);
  if (!["managed", "imported"].includes(recordText(adoption, "mode"))) {
    errors.push("EC2 ASG IaC plan requires reviewed import adoption mode");
  }
  if (recordText(adoption, "mode") === "imported" && !recordText(adoption, "reviewedReference")) {
    errors.push("EC2 ASG import requires reviewed import reference");
  }
  return errors;
}

function validateApply(value: unknown, planValue: unknown, opts: ExpectedInputs) {
  const apply = recordObject(value);
  const plan = recordObject(planValue);
  const errors = common("apply", apply, EC2_ASG_APPLY_SCHEMA, EC2_ASG_IAC_PATHS.apply);
  if (recordText(apply, "source") !== "reviewed-opentofu-apply") {
    errors.push("EC2 ASG IaC apply must come from reviewed OpenTofu apply");
  }
  if (recordText(apply, "planDigest") !== recordText(plan, "planDigest")) {
    errors.push("EC2 ASG IaC apply planDigest does not match reviewed plan");
  }
  errors.push(...userDataTransitionErrors("apply", apply, plan, "plan"));
  errors.push(...identityErrors("apply", apply, opts));
  errors.push(...postureErrors("apply", apply, opts));
  return errors;
}

function validateReadOnly(value: unknown, applyValue: unknown, opts: ExpectedInputs) {
  const evidence = recordObject(value);
  const apply = recordObject(applyValue);
  const errors = common(
    "read-only evidence",
    evidence,
    EC2_ASG_READONLY_SCHEMA,
    EC2_ASG_IAC_PATHS.readOnly,
  );
  if (recordText(evidence, "source") !== "aws-ec2-asg-readonly-inspection") {
    errors.push("EC2 ASG evidence must come from read-only AWS inspection");
  }
  if (recordText(evidence, "applyDigest") !== recordText(apply, "applyDigest")) {
    errors.push("EC2 ASG read-only evidence applyDigest does not match reviewed apply");
  }
  errors.push(...userDataTransitionErrors("read-only evidence", evidence, apply, "apply"));
  errors.push(...identityErrors("read-only evidence", evidence, opts));
  errors.push(...postureErrors("read-only evidence", evidence, opts));
  return errors;
}

type ExpectedInputs = {
  topology?: AwsTopologyEvidence;
  profile?: Record<string, unknown>;
  expectedMode?: Ec2HostMode;
};

function common(label: string, record: Record<string, unknown>, schema: string, path: string) {
  const errors: string[] = [];
  if (record.schemaVersion !== schema) errors.push(`EC2 ASG ${label} missing ${schema}`);
  if (recordText(record, "workingDirectory") !== EC2_ASG_OPENTOFU_WORKING_DIR) {
    errors.push(`EC2 ASG ${label} must use ASG-specific bundle-root OpenTofu working directory`);
  }
  const digest =
    recordText(record, "planDigest") ||
    recordText(record, "applyDigest") ||
    recordText(record, "evidenceDigest");
  if (!EC2_ASG_SHA256.test(digest)) {
    errors.push(`EC2 ASG ${label} missing sha256 provenance digest`);
  }
  if (recordText(record, "evidencePath") && recordText(record, "evidencePath") !== path) {
    errors.push(`EC2 ASG ${label} evidencePath does not match generated path`);
  }
  return errors;
}

function identityErrors(label: string, record: Record<string, unknown>, opts: ExpectedInputs) {
  const expected = recordObject(record.expected);
  const compute = recordObject(opts.topology?.compute);
  const errors: string[] = [];
  if (recordText(record, "ec2HostMode") !== "repo-owned-asg") {
    errors.push(`EC2 ASG ${label} must be scoped to repo-owned-asg`);
  }
  compareEvidenceField(
    errors,
    label,
    "accountId",
    recordText(expected, "accountId"),
    opts.topology?.accountId,
  );
  compareEvidenceField(
    errors,
    label,
    "region",
    recordText(expected, "region"),
    opts.topology?.region,
  );
  compareEvidenceField(
    errors,
    label,
    "autoScalingGroupName",
    recordText(expected, "autoScalingGroupName"),
    recordText(compute, "autoScalingGroupName"),
  );
  compareEvidenceField(
    errors,
    label,
    "launchTemplateId",
    recordText(expected, "launchTemplateId"),
    recordText(compute, "launchTemplateId"),
  );
  compareEvidenceField(
    errors,
    label,
    "launchTemplateVersion",
    recordText(expected, "launchTemplateVersion"),
    recordText(compute, "launchTemplateVersion"),
  );
  compareEvidenceField(
    errors,
    label,
    "amiId",
    recordText(expected, "amiId"),
    recordText(compute, "amiId"),
  );
  errors.push(...amiEvidenceErrors(label, expected, compute));
  compareEvidenceField(
    errors,
    label,
    "instanceType",
    recordText(expected, "instanceType"),
    recordText(compute, "instanceType"),
  );
  compareEvidenceField(
    errors,
    label,
    "instanceProfileArn",
    recordText(expected, "instanceProfileArn"),
    recordText(compute, "instanceProfileArn"),
  );
  errors.push(...userDataIdentityErrors(label, record, opts.profile));
  return errors;
}

function postureErrors(label: string, record: Record<string, unknown>, opts: ExpectedInputs) {
  const expected = recordObject(record.expected);
  const topologyCompute = recordObject(opts.topology?.compute);
  const profileCompute = recordObject(opts.profile?.compute);
  const errors: string[] = [];
  if (expected.serviceCapacity !== 1) errors.push(`EC2 ASG ${label} requires one service host`);
  if (Number(expected.workerReplicas) < 2)
    errors.push(`EC2 ASG ${label} requires reviewed worker placement`);
  if (recordObject(record.security).httpTokens !== "required")
    errors.push(`EC2 ASG ${label} must enforce IMDSv2`);
  if (recordObject(record.rollback).nonDestructive !== true)
    errors.push(`EC2 ASG ${label} requires non-destructive rollback`);
  if (recordObject(record.observability).logSink !== "cloudwatch")
    errors.push(`EC2 ASG ${label} log sink does not match reviewed posture`);
  if (recordObject(record.observability).alarmPosture !== "required")
    errors.push(`EC2 ASG ${label} alarm posture does not match reviewed posture`);
  if (!recordText(record, "reviewedInstancePosture"))
    errors.push(`EC2 ASG ${label} missing reviewed instance posture`);
  sameEvidenceSet(
    errors,
    label,
    "privateSubnetIds",
    recordList(expected, "privateSubnetIds"),
    recordList(topologyCompute, "launchTemplateSubnetIds"),
  );
  sameEvidenceSet(
    errors,
    label,
    "securityGroupIds",
    recordList(expected, "securityGroupIds"),
    recordList(profileCompute, "securityGroupIds"),
  );
  return errors;
}
