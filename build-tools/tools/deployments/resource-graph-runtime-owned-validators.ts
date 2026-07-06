#!/usr/bin/env zx-wrapper
import { validateAwsEc2ControlPlaneObservability } from "./cloud-control-aws-ec2-observability";
import { validateAuthProviderProfile } from "./cloud-control-auth-provider-profile";
import { validateCloudControlCutover } from "./cloud-control-cutover-validate";
import { validateRuntimeInput } from "./cloud-control-runtime-input";
import { validateMiniCloudMigrationEvidence } from "./control-plane-mini-migration-preflight";

export type RuntimeEvidenceObjectValidation = {
  evidenceKind: string;
  evidenceSchemaVersion: string;
  deploymentId: string;
  nowMs: number;
  maxAgeMinutes: number;
};

export function validateRuntimeEvidenceObject(
  value: unknown,
  opts: RuntimeEvidenceObjectValidation,
): string[] {
  const record = value as Record<string, unknown>;
  return [
    ...(record?.evidenceKind === opts.evidenceKind
      ? []
      : [`${opts.evidenceKind} owned evidence kind mismatch`]),
    ...(record?.schemaVersion === opts.evidenceSchemaVersion
      ? []
      : [`${opts.evidenceKind} owned evidence schemaVersion invalid`]),
    ...deploymentErrors(record, opts),
    ...authorityErrors(record, opts.evidenceKind),
    ...kindValidationErrors(value, opts),
  ];
}

function kindValidationErrors(value: unknown, opts: RuntimeEvidenceObjectValidation) {
  try {
    return uncheckedKindValidationErrors(value, opts);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function uncheckedKindValidationErrors(value: unknown, opts: RuntimeEvidenceObjectValidation) {
  const runtimeOpts = {
    expectedCallbackHost: "deploy-auth.example.test",
    expectedCallbackPath: "/oidc/callback",
    deploymentIds: [opts.deploymentId],
    production: true,
  };
  if (opts.evidenceKind === "RuntimeInput") {
    return validateRuntimeInput(value as never, runtimeOpts);
  }
  if (opts.evidenceKind === "AuthProviderProfile") {
    return validateAuthProviderProfile(value as never, runtimeOpts);
  }
  if (opts.evidenceKind === "ControlPlaneReadinessEvidence") {
    const record = value as Record<string, unknown>;
    const errors = validateCloudControlCutover(value as never, {
      maxAgeMinutes: opts.maxAgeMinutes,
      expectedHostProfile: String(record.hostProfile || "aws-ec2"),
      selectedCapabilities: Array.isArray(record.selectedProviderCapabilities)
        ? record.selectedProviderCapabilities.map(String)
        : [],
      expectedImageBuildIdentity: String(record.expectedImageBuildIdentity || ""),
      operation: "cutover",
    }).errors;
    return errors.filter((error) => !externalReadinessDependency(error));
  }
  if (opts.evidenceKind === "ControlPlaneObservabilityEvidence") {
    return validateAwsEc2ControlPlaneObservability(value, {
      maxAgeMinutes: opts.maxAgeMinutes,
      nowMs: opts.nowMs,
      expectedProvider: "aws-ec2",
    });
  }
  if (opts.evidenceKind === "MiniMigrationPreflightEvidence") {
    return validateMiniMigration(value);
  }
  return [`${opts.evidenceKind} owned evidence validator is not registered`];
}

function externalReadinessDependency(error: string) {
  return /Supabase|managed Postgres Supabase|cutover topology missing reviewed runtime instance-profile|cutover topology missing reviewed runtime least-privilege/.test(
    error,
  );
}

function deploymentErrors(record: Record<string, unknown>, opts: RuntimeEvidenceObjectValidation) {
  const ids = Array.isArray(record.deploymentIds) ? record.deploymentIds.map(String) : [];
  return record.deploymentId === opts.deploymentId || ids.includes(opts.deploymentId)
    ? []
    : [`${opts.evidenceKind} owned evidence deployment mismatch`];
}

function authorityErrors(record: Record<string, unknown>, evidenceKind: string) {
  return [
    ...(record?.validatedBy === "cloudflare-pages-control-plane-reconciler"
      ? []
      : [`${evidenceKind} owned evidence authority is missing`]),
    ...(record?.validationStatus === "passed"
      ? []
      : [`${evidenceKind} owned evidence is not validated`]),
    ...(Number.isFinite(Date.parse(String(record?.checkedAt || "")))
      ? []
      : [`${evidenceKind} owned evidence validation timestamp is missing or invalid`]),
    ...(record?.owningProvider === "aws-ec2"
      ? []
      : [`${evidenceKind} owned evidence provider mismatch`]),
    ...(record?.owningControlPlaneProfileId === "cloudflare-pages-control-plane"
      ? []
      : [`${evidenceKind} owned evidence control-plane profile mismatch`]),
  ];
}

function validateMiniMigration(value: unknown) {
  try {
    validateMiniCloudMigrationEvidence(value as never);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}
