import { freshEvidenceAt } from "./cloud-control-evidence-helpers";

const BUNDLE_ROOT = "$PROFILE_ROOT";
export const AWS_ECR_OPENTOFU_DIR = "$PROFILE_ROOT/opentofu/aws-control-plane-foundation";
export const AWS_ECR_OPENTOFU_TFVARS = "$PROFILE_ROOT/ecr-opentofu.tfvars.json";
export const AWS_ECR_OPENTOFU_BACKEND = "$PROFILE_ROOT/ecr-backend.hcl";

export const AWS_ECR_EVIDENCE_PATHS = {
  plan: "$PROFILE_ROOT/ecr-opentofu-plan.json",
  apply: "$PROFILE_ROOT/ecr-opentofu-apply.json",
  readOnly: "$PROFILE_ROOT/ecr-readonly-evidence.json",
} as const;

export function ecrCommonEvidenceErrors(
  label: string,
  record: Record<string, unknown>,
  schema: string,
  evidencePath: string,
) {
  const errors: string[] = [];
  if (record.schemaVersion !== schema) errors.push(`ECR IaC ${label} schema is unsupported`);
  if (!freshEvidenceAt(record, { maxAgeMinutes: 60 })) {
    errors.push(`ECR IaC ${label} is missing or stale`);
  }
  if (text(record, "bundleRoot") !== BUNDLE_ROOT) {
    errors.push(`ECR IaC ${label} must resolve from setup bundle root`);
  }
  if (text(record, "workingDirectory") !== AWS_ECR_OPENTOFU_DIR) {
    errors.push(`ECR IaC ${label} working directory must resolve from setup bundle root`);
  }
  if (text(record, "evidencePath") !== evidencePath) {
    errors.push(`ECR IaC ${label} evidence path must resolve from setup bundle root`);
  }
  if (!isBundleRootPath(text(record, "outputPath"))) {
    errors.push(`ECR IaC ${label} output path must resolve from setup bundle root`);
  }
  return errors;
}

export function ecrPostureErrors(record: Record<string, unknown>) {
  const posture = object(record.posture);
  const kms = object(posture.kms);
  const errors: string[] = [];
  if (text(posture, "tagMutability") !== "IMMUTABLE")
    errors.push("ECR IaC requires immutable tags");
  if (
    !Number.isFinite(Number(posture.lifecycleRuleCount)) ||
    Number(posture.lifecycleRuleCount) < 1
  ) {
    errors.push("ECR IaC requires lifecycle policy posture");
  }
  if (!text(posture, "lifecyclePolicyDigest")) errors.push("ECR IaC missing lifecycle digest");
  if (posture.scanOnPush !== true) errors.push("ECR IaC requires scan-on-push posture");
  if (!text(posture, "repositoryPolicyDigest")) errors.push("ECR IaC missing policy digest");
  if (!["aws-managed", "customer-managed"].includes(text(kms, "mode"))) {
    errors.push("ECR IaC requires KMS encryption posture");
  }
  return errors;
}

export function ecrPostureMatchErrors(
  label: string,
  actualRecord: Record<string, unknown>,
  expectedRecord: Record<string, unknown>,
  expectedLabel: string,
) {
  const actual = object(actualRecord.posture);
  const expected = object(expectedRecord.posture);
  const errors: string[] = [];
  for (const [key, description] of [
    ["tagMutability", "tag mutability"],
    ["scanOnPush", "scan-on-push"],
    ["lifecyclePolicyDigest", "lifecycle policy"],
    ["lifecycleRuleCount", "lifecycle rule count"],
    ["repositoryPolicyDigest", "repository policy"],
  ] as const) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
      errors.push(`ECR IaC ${label} ${description} does not match ${expectedLabel}`);
    }
  }
  if (stableJson(object(actual.kms)) !== stableJson(object(expected.kms))) {
    errors.push(`ECR IaC ${label} KMS encryption posture does not match ${expectedLabel}`);
  }
  return errors;
}

function isBundleRootPath(value: string): boolean {
  return (
    value.startsWith(`${BUNDLE_ROOT}/`) &&
    !value.includes("..") &&
    value.length > BUNDLE_ROOT.length + 1
  );
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = value[key];
        return acc;
      }, {}),
  );
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === "string" ? record[key].trim() : "";
}
