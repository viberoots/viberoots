import type { AwsTopologyEvidence } from "./cloud-control-aws-topology-types";
import {
  AWS_ECR_EVIDENCE_PATHS,
  ecrCommonEvidenceErrors,
  ecrPostureErrors,
  ecrPostureMatchErrors,
} from "./cloud-control-aws-ecr-iac-evidence-rules";
import type { ControlPlaneRegistryProfile } from "./control-plane-registry-profile";

export const AWS_ECR_OPENTOFU_PLAN_SCHEMA = "aws-ecr-opentofu-plan@1";
export const AWS_ECR_OPENTOFU_APPLY_SCHEMA = "aws-ecr-opentofu-apply@1";
export const AWS_ECR_READONLY_EVIDENCE_SCHEMA = "aws-ecr-readonly-evidence@1";

export type AwsEcrIacEvidenceBundle = {
  plan?: Record<string, unknown>;
  apply?: Record<string, unknown>;
  readOnly?: Record<string, unknown>;
};

export function validateAwsEcrIacBundle(opts: {
  profile: ControlPlaneRegistryProfile;
  phase: string;
  topology?: AwsTopologyEvidence;
}): string[] {
  const iac = opts.profile.iac || {};
  return [
    ...validatePlan(opts.profile, iac.plan, opts.topology),
    ...requiresApply(opts.phase).flatMap(() => validateApply(opts.profile, iac.apply)),
    ...requiresReadOnly(opts.phase).flatMap(() => validateReadOnly(opts.profile, iac.readOnly)),
  ];
}

export function validateAwsEcrProviderPayload(
  id: string,
  phase: string,
  payload: unknown,
  topology?: unknown,
): string[] {
  if (id !== "aws-ecr-control-plane-registry") return [];
  const record = object(payload);
  if (Object.keys(record).length === 0) return [`${id}: missing ECR IaC provider payload`];
  const profile = object(record.registryProfile) as ControlPlaneRegistryProfile;
  const errors = validateAwsEcrIacBundle({
    profile,
    phase,
    topology: object(topology) as AwsTopologyEvidence,
  });
  if (hasDirectEcrMutation(record)) {
    errors.push("custom hook payload must not contain direct ECR mutation commands");
  }
  return errors.map((error) => `${id}: ${error}`);
}

export function awsEcrIacSummary(profile: ControlPlaneRegistryProfile) {
  const iac = profile.iac || {};
  return {
    plan: summarizeEvidence(iac.plan),
    apply: summarizeEvidence(iac.apply),
    readOnly: summarizeEvidence(iac.readOnly),
  };
}

function validatePlan(
  profile: ControlPlaneRegistryProfile,
  value: unknown,
  topology?: AwsTopologyEvidence,
): string[] {
  const plan = object(value);
  const errors = commonEvidenceErrors(
    "plan",
    plan,
    AWS_ECR_OPENTOFU_PLAN_SCHEMA,
    AWS_ECR_EVIDENCE_PATHS.plan,
  );
  if (text(plan, "source") !== "reviewed-opentofu-plan") {
    errors.push("ECR IaC plan must come from reviewed OpenTofu plan");
  }
  errors.push(...identityErrors("plan", profile, plan, topology));
  errors.push(...ecrPostureErrors(plan));
  const adoption = object(plan.importAdoption);
  if (!["managed", "imported"].includes(text(adoption, "mode"))) {
    errors.push("ECR IaC plan requires import/adoption mode");
  }
  if (profile.mode === "imported" && !text(adoption, "reviewedReference")) {
    errors.push("imported ECR profile requires reviewed import/adoption reference");
  }
  return errors;
}

function validateApply(profile: ControlPlaneRegistryProfile, value: unknown): string[] {
  const apply = object(value);
  const errors = commonEvidenceErrors(
    "apply",
    apply,
    AWS_ECR_OPENTOFU_APPLY_SCHEMA,
    AWS_ECR_EVIDENCE_PATHS.apply,
  );
  const plan = object(profile.iac?.plan);
  if (text(apply, "source") !== "reviewed-opentofu-apply") {
    errors.push("ECR IaC apply must come from reviewed OpenTofu apply");
  }
  if (text(apply, "planDigest") !== text(plan, "planDigest")) {
    errors.push("ECR IaC apply plan digest does not match reviewed plan");
  }
  errors.push(...identityErrors("apply", profile, apply));
  errors.push(...ecrPostureErrors(apply));
  errors.push(...ecrPostureMatchErrors("apply", apply, plan, "reviewed plan"));
  return errors;
}

function validateReadOnly(profile: ControlPlaneRegistryProfile, value: unknown): string[] {
  const evidence = object(value);
  const errors = commonEvidenceErrors(
    "read-only evidence",
    evidence,
    AWS_ECR_READONLY_EVIDENCE_SCHEMA,
    AWS_ECR_EVIDENCE_PATHS.readOnly,
  );
  if (text(evidence, "source") !== "aws-ecr-readonly-inspection") {
    errors.push("ECR evidence must be read-only AWS inspection");
  }
  errors.push(...identityErrors("read-only evidence", profile, evidence));
  errors.push(...ecrPostureErrors(evidence));
  errors.push(
    ...ecrPostureMatchErrors(
      "read-only evidence",
      evidence,
      object(profile.iac?.plan),
      "reviewed plan",
    ),
  );
  errors.push(
    ...ecrPostureMatchErrors(
      "read-only evidence",
      evidence,
      object(profile.iac?.apply),
      "reviewed apply",
    ),
  );
  return errors;
}

function commonEvidenceErrors(
  label: string,
  record: Record<string, unknown>,
  schema: string,
  evidencePath: string,
) {
  return ecrCommonEvidenceErrors(label, record, schema, evidencePath);
}

function identityErrors(
  label: string,
  profile: ControlPlaneRegistryProfile,
  record: Record<string, unknown>,
  topology?: AwsTopologyEvidence,
) {
  const repository = object(record.repository);
  const identity = object(profile.identity);
  const errors: string[] = [];
  for (const key of ["accountId", "region", "repositoryArn", "repositoryUri"] as const) {
    if (text(repository, key) !== text(identity, key)) {
      errors.push(`ECR IaC ${label} repository ${key} does not match registry profile`);
    }
  }
  if (topology?.accountId && text(repository, "accountId") !== topology.accountId) {
    errors.push("ECR IaC repository account does not match trusted AWS topology");
  }
  if (topology?.region && text(repository, "region") !== topology.region) {
    errors.push("ECR IaC repository region does not match trusted AWS topology");
  }
  return errors;
}

function requiresApply(phase: string) {
  return ["apply", "evidence", "smoke"].includes(phase) ? [true] : [];
}

function requiresReadOnly(phase: string) {
  return ["evidence", "smoke"].includes(phase) ? [true] : [];
}

function hasDirectEcrMutation(value: unknown): boolean {
  return /aws\s+ecr\s+(create-repository|put-lifecycle-policy|set-repository-policy|put-image-tag-mutability|put-image-scanning-configuration|delete-repository)/i.test(
    JSON.stringify(value),
  );
}

function summarizeEvidence(value: unknown) {
  const record = object(value);
  return {
    schemaVersion: text(record, "schemaVersion"),
    source: text(record, "source"),
    digest:
      text(record, "planDigest") || text(record, "applyDigest") || text(record, "evidenceDigest"),
    workingDirectory: text(record, "workingDirectory"),
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === "string" ? record[key].trim() : "";
}
