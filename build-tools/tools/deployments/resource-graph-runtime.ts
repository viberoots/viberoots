#!/usr/bin/env zx-wrapper
import { REQUIRED_AWS_EC2_ALARMS } from "./cloud-control-aws-ec2-alarms";
import { validateAuthProviderProfile } from "./cloud-control-auth-provider-profile";
import { validateCloudControlCutover } from "./cloud-control-cutover-validate";
import { validateRuntimeInput } from "./cloud-control-runtime-input";
import { validateMiniCloudMigrationEvidence } from "./control-plane-mini-migration-preflight";
import { collectRuntimeArtifactStatus } from "./resource-graph-runtime-artifacts";
import { collectServiceClientSelectionResources } from "./resource-graph-service-client";
import { isAdmittedControlPlaneRuntimeRecord } from "./resource-graph-types";
import type {
  DeploymentResourceInventoryEntry,
  DeploymentRuntimeInventorySources,
  RuntimeSourceRecord,
  RuntimeStatusRecord,
  RuntimeValidationOptions,
} from "./resource-graph-types";

type RuntimeCollection = { resources: DeploymentResourceInventoryEntry[]; errors: string[] };

export function collectRuntimeInventoryResources(
  sources: DeploymentRuntimeInventorySources = {},
): RuntimeCollection {
  const out: DeploymentResourceInventoryEntry[] = [];
  const errors: string[] = [];
  collectValidated(out, errors, "RuntimeInput", sources.runtimeInputs, validateRuntimeInputRecord);
  collectValidated(
    out,
    errors,
    "AuthProviderProfile",
    sources.authProviderProfiles,
    validateAuthProviderRecord,
  );
  collectValidated(
    out,
    errors,
    "ControlPlaneReadinessEvidence",
    sources.readinessEvidence,
    validateReadinessEvidence,
  );
  collectValidated(
    out,
    errors,
    "ControlPlaneObservabilityEvidence",
    sources.observabilityEvidence,
    validateObservabilityEvidence,
  );
  collectValidated(
    out,
    errors,
    "MiniMigrationPreflightEvidence",
    sources.miniMigrationEvidence,
    validateMiniMigrationRecord,
  );
  collectRuntimeArtifactStatus(out, errors, {
    artifactChallenges: sources.artifactChallenges,
    uploadSessions: sources.staticWebappUploadSessions,
    artifactBindingProvenance: sources.artifactBindingProvenance,
    cleanupEvidence: sources.cleanupEvidence,
    artifactCleanupJanitorRecords: sources.artifactCleanupJanitorRecords,
  });
  collectStatus(out, errors, "ExecutionSnapshot", sources.executionSnapshots, [
    "snapshotId",
    "deploymentId",
    "capturedAt",
  ]);
  collectStatus(out, errors, "DeployRun", sources.deployRuns, ["runId", "deploymentId", "status"]);
  collectStatus(out, errors, "RunAction", sources.runActions, ["actionId", "runId", "status"]);
  collectStatus(out, errors, "CurrentStageState", sources.currentStageStates, [
    "deploymentId",
    "stage",
    "state",
  ]);
  collectStatus(out, errors, "StageHistoryEntry", sources.stageHistoryEntries, [
    "historyId",
    "deploymentId",
    "stage",
  ]);
  collectStatus(out, errors, "AuditEvent", sources.auditEvents, ["eventId", "actor", "action"]);
  collectStatus(out, errors, "RetainedEvidence", sources.retainedEvidence, [
    "evidenceId",
    "digest",
  ]);
  collectStatus(out, errors, "ControlPlaneRuntime", sources.controlPlaneRuntime, [
    "instanceId",
    "endpoint",
    "status",
  ]);
  collectServiceClientSelectionResources(out, errors, sources);
  return { resources: out, errors };
}

function collectValidated(
  out: DeploymentResourceInventoryEntry[],
  errors: string[],
  kind: DeploymentResourceInventoryEntry["kind"],
  records: RuntimeSourceRecord[] | undefined,
  validate: (record: RuntimeSourceRecord) => string[],
) {
  for (const record of records || []) {
    if (!isAdmittedControlPlaneRuntimeRecord(record)) {
      errors.push(`${kind} ${record.id}: runtime source is not an admitted control-plane record`);
      continue;
    }
    const validationErrors = validate(record);
    if (validationErrors.length > 0) {
      errors.push(...validationErrors.map((error) => `${kind} ${record.id}: ${error}`));
      continue;
    }
    out.push(runtimeEntry(kind, record.id, record.refs, { value: record.value }, record.source));
  }
}

function collectStatus(
  out: DeploymentResourceInventoryEntry[],
  errors: string[],
  kind: DeploymentResourceInventoryEntry["kind"],
  records: RuntimeStatusRecord[] | undefined,
  required: string[],
) {
  for (const record of records || []) {
    if (!isAdmittedControlPlaneRuntimeRecord(record)) {
      errors.push(`${kind} ${record.id}: runtime source is not an admitted control-plane record`);
      continue;
    }
    const missing = required.filter((field) => !String(record.facts[field] || "").trim());
    const forbidden = ["token", "rawToken", "secret", "proof", "nonce"].filter(
      (field) => record.facts[field] !== undefined,
    );
    if (missing.length || forbidden.length) {
      errors.push(
        `${kind} ${record.id}: invalid runtime source (${[
          missing.length ? `missing ${missing.join(", ")}` : "",
          forbidden.length ? `forbidden secret fields ${forbidden.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; ")})`,
      );
      continue;
    }
    out.push(runtimeEntry(kind, record.id, record.refs, record.facts, record.source));
  }
}

function validateRuntimeInputRecord(record: RuntimeSourceRecord): string[] {
  return validateRuntimeInput(record.value as never, runtimeOptions(record));
}

function validateAuthProviderRecord(record: RuntimeSourceRecord): string[] {
  return validateAuthProviderProfile(record.value as never, runtimeOptions(record));
}

function validateReadinessEvidence(record: RuntimeSourceRecord): string[] {
  return validateCloudControlCutover(
    record.value as never,
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

function validateObservabilityEvidence(record: RuntimeSourceRecord): string[] {
  const value = record.value as Record<string, unknown>;
  const alarms = Array.isArray(value.alarms) ? value.alarms : [];
  const alarmIds = new Set(
    alarms.map((entry) =>
      entry && typeof entry === "object" ? String((entry as Record<string, unknown>).id) : "",
    ),
  );
  return [
    value.schemaVersion === "aws-ec2-control-plane-observability@1"
      ? ""
      : "observability schemaVersion invalid",
    value.logSink ? "" : "observability logSink is required",
    value.unitLogRouting ? "" : "observability unitLogRouting is required",
    value.history ? "" : "observability history is required",
    ...REQUIRED_AWS_EC2_ALARMS.filter((id) => !alarmIds.has(id)).map(
      (id) => `observability missing alarm ${id}`,
    ),
  ].filter(Boolean);
}

function validateMiniMigrationRecord(record: RuntimeSourceRecord): string[] {
  try {
    validateMiniCloudMigrationEvidence(record.value as never);
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

function runtimeEntry(
  kind: DeploymentResourceInventoryEntry["kind"],
  id: string,
  refs: string[] | undefined,
  facts: Record<string, unknown>,
  source: DeploymentResourceInventoryEntry["source"] = { class: "runtime" },
): DeploymentResourceInventoryEntry {
  return {
    kind,
    id,
    authority: "observed_runtime",
    source,
    ...(refs ? { refs } : {}),
    facts: redactUndefined(facts),
  };
}

function redactUndefined(facts: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined));
}
