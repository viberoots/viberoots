import type { AwsTopologyEvidence } from "./cloud-control-aws-topology-types";
import { EC2_ASG_CREDENTIAL_MODES, EC2_ASG_SHA256 } from "./cloud-control-aws-ec2-asg-iac-types";
import {
  compareEvidenceField,
  recordObject,
  recordText,
} from "./cloud-control-aws-ec2-asg-iac-helpers";

const REJECTED_MODES = new Set(["ambient", "default", "default-chain", "env", "environment"]);

export function planCredentialBoundaryErrors(
  label: string,
  record: Record<string, unknown>,
  topology?: AwsTopologyEvidence,
): string[] {
  return credentialErrors(label, recordObject(record.reviewedCredentialBoundary), topology);
}

export function applyCredentialBoundaryErrors(
  apply: Record<string, unknown>,
  plan: Record<string, unknown>,
  topology?: AwsTopologyEvidence,
): string[] {
  const errors = credentialErrors(
    "apply",
    recordObject(apply.reviewedCredentialBoundary),
    topology,
  );
  if (!sameBoundary(apply.reviewedCredentialBoundary, plan.reviewedCredentialBoundary)) {
    errors.push("EC2 ASG apply credential boundary does not match reviewed plan");
  }
  return errors;
}

export function readOnlyCredentialBoundaryErrors(
  evidence: Record<string, unknown>,
  apply: Record<string, unknown>,
  topology?: AwsTopologyEvidence,
): string[] {
  const provenance = recordObject(evidence.credentialProvenance);
  const errors = credentialErrors("read-only evidence", provenance, topology);
  if (!sameBoundary(provenance, apply.reviewedCredentialBoundary)) {
    errors.push("EC2 ASG read-only credential boundary does not match reviewed apply");
  }
  if (
    recordText(evidence, "callerIdentityEvidencePath") !==
    "$PROFILE_ROOT/ec2-asg-readonly-caller-identity.json"
  ) {
    errors.push("EC2 ASG read-only evidence missing caller identity evidence path");
  }
  return errors;
}

function credentialErrors(
  label: string,
  provenance: Record<string, unknown>,
  topology?: AwsTopologyEvidence,
): string[] {
  const errors: string[] = [];
  const mode = recordText(provenance, "mode");
  if (!mode) errors.push(`EC2 ASG ${label} missing reviewed credential provenance`);
  if (REJECTED_MODES.has(mode) || !EC2_ASG_CREDENTIAL_MODES.includes(mode as any)) {
    errors.push(`EC2 ASG ${label} credential provenance is ambient or unreviewed`);
  }
  compareEvidenceField(
    errors,
    label,
    "credential accountId",
    recordText(provenance, "accountId"),
    topology?.accountId,
  );
  compareEvidenceField(
    errors,
    label,
    "credential region",
    recordText(provenance, "region"),
    topology?.region,
  );
  if (!recordText(provenance, "reviewedReference")) {
    errors.push(`EC2 ASG ${label} credential provenance missing reviewed reference`);
  }
  if (!EC2_ASG_SHA256.test(recordText(provenance, "boundaryDigest"))) {
    errors.push(`EC2 ASG ${label} credential provenance missing boundary digest`);
  }
  errors.push(...modeSpecificErrors(label, provenance, mode));
  return errors;
}

function modeSpecificErrors(label: string, provenance: Record<string, unknown>, mode: string) {
  if (mode === "file-backed-profile") {
    const errors =
      recordText(provenance, "profileName") && recordText(provenance, "sharedCredentialsFile")
        ? []
        : [`EC2 ASG ${label} file-backed profile provenance is incomplete`];
    if (recordText(provenance, "profileName") === "default") {
      errors.push(`EC2 ASG ${label} credential provenance uses default profile`);
    }
    return errors;
  }
  if (mode === "assume-role") {
    const errors =
      recordText(provenance, "roleArn") &&
      recordText(provenance, "sessionName") &&
      recordText(provenance, "sourceProfileName") &&
      recordText(provenance, "sharedCredentialsFile")
        ? []
        : [`EC2 ASG ${label} assume-role provenance is incomplete`];
    if (recordText(provenance, "sourceProfileName") === "default") {
      errors.push(`EC2 ASG ${label} credential provenance uses default source profile`);
    }
    return errors;
  }
  if (mode === "instance-profile") {
    return recordText(provenance, "instanceProfileArn")
      ? []
      : [`EC2 ASG ${label} instance-profile provenance is incomplete`];
  }
  return [];
}

function sameBoundary(left: unknown, right: unknown): boolean {
  const a = recordObject(left);
  const b = recordObject(right);
  return (
    recordText(a, "mode") === recordText(b, "mode") &&
    recordText(a, "accountId") === recordText(b, "accountId") &&
    recordText(a, "region") === recordText(b, "region") &&
    recordText(a, "boundaryDigest") === recordText(b, "boundaryDigest")
  );
}
