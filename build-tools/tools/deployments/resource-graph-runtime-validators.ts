#!/usr/bin/env zx-wrapper
import {
  AWS_EC2_CONTROL_PLANE_OBSERVABILITY_SCHEMA,
  validateAwsEc2ControlPlaneObservability,
} from "./cloud-control-aws-ec2-observability";
import {
  AUTH_PROVIDER_PROFILE_SCHEMA,
  validateAuthProviderProfile,
} from "./cloud-control-auth-provider-profile";
import { validateCloudControlCutover } from "./cloud-control-cutover-validate";
import { RUNTIME_INPUT_SCHEMA, validateRuntimeInput } from "./cloud-control-runtime-input";
import { validateMiniCloudMigrationEvidence } from "./control-plane-mini-migration-preflight";
import {
  validateEvidenceReference,
  validateReadinessReference,
} from "./resource-graph-runtime-reference";
import type { RuntimeSourceRecord, RuntimeValidationOptions } from "./resource-graph-types";

export function validateRuntimeInputRecord(record: RuntimeSourceRecord): string[] {
  const referenceErrors = validateEvidenceReference(
    record.value,
    record,
    "cloud-control-runtime-input-reference@1",
    "runtime input",
    {
      evidenceKind: "RuntimeInput",
      evidenceSchemaVersion: RUNTIME_INPUT_SCHEMA,
      validateResolved: (value) => validateRuntimeInput(value as never, runtimeOptions(record)),
    },
  );
  return referenceErrors || validateRuntimeInput(record.value as never, runtimeOptions(record));
}

export function validateAuthProviderRecord(record: RuntimeSourceRecord): string[] {
  const referenceErrors = validateEvidenceReference(
    record.value,
    record,
    "auth-provider-profile-reference@1",
    "auth-provider profile",
    {
      evidenceKind: "AuthProviderProfile",
      evidenceSchemaVersion: AUTH_PROVIDER_PROFILE_SCHEMA,
      validateResolved: (value) =>
        validateAuthProviderProfile(value as never, runtimeOptions(record)),
    },
  );
  return (
    referenceErrors || validateAuthProviderProfile(record.value as never, runtimeOptions(record))
  );
}

export function validateReadinessEvidence(record: RuntimeSourceRecord): string[] {
  const referenceErrors = validateReadinessReference(record.value, record, (value) =>
    validateCutover(record, value),
  );
  return referenceErrors || validateCutover(record, record.value);
}

export function validateObservabilityEvidence(record: RuntimeSourceRecord): string[] {
  const referenceErrors = validateEvidenceReference(
    record.value,
    record,
    "aws-ec2-control-plane-observability-reference@1",
    "observability",
    {
      evidenceKind: "ControlPlaneObservabilityEvidence",
      evidenceSchemaVersion: AWS_EC2_CONTROL_PLANE_OBSERVABILITY_SCHEMA,
      validateResolved: (value) => validateObservability(record, value),
    },
  );
  return referenceErrors || validateObservability(record, record.value);
}

export function validateMiniMigrationRecord(record: RuntimeSourceRecord): string[] {
  const referenceErrors = validateEvidenceReference(
    record.value,
    record,
    "mini-migration-preflight-reference@1",
    "mini-migration",
    {
      evidenceKind: "MiniMigrationPreflightEvidence",
      evidenceSchemaVersion: "mini-migration-preflight@1",
      validateResolved: validateMiniMigration,
    },
  );
  return referenceErrors || validateMiniMigration(record.value);
}

function validateCutover(record: RuntimeSourceRecord, value: unknown): string[] {
  return validateCloudControlCutover(
    value as never,
    {
      ...runtimeOptions(record),
      maxAgeMinutes: record.validation?.maxAgeMinutes || 60,
      expectedHostProfile: String(record.validation?.expectedHostProfile || "aws-ec2"),
      selectedCapabilities: [],
      expectedImageBuildIdentity: String(record.validation?.expectedImageBuildIdentity || ""),
      operation: String(record.validation?.operation || "cutover"),
    } as never,
  ).errors;
}

function validateObservability(record: RuntimeSourceRecord, value: unknown): string[] {
  return validateAwsEc2ControlPlaneObservability(value, {
    maxAgeMinutes: Number(record.validation?.maxAgeMinutes || 60),
    nowMs: Number(record.validation?.nowMs || Date.now()),
    expectedProvider: String(record.validation?.expectedProvider || "aws-ec2"),
  });
}

function validateMiniMigration(value: unknown): string[] {
  try {
    validateMiniCloudMigrationEvidence(value as never);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function runtimeOptions(record: RuntimeSourceRecord): RuntimeValidationOptions {
  return {
    expectedCallbackHost: String(record.validation?.expectedCallbackHost || ""),
    expectedCallbackPath: String(record.validation?.expectedCallbackPath || ""),
    deploymentIds: record.validation?.deploymentIds || [],
    production: record.validation?.production !== false,
  };
}
