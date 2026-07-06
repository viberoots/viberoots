#!/usr/bin/env zx-wrapper
import {
  validateAuthProviderRecord,
  validateMiniMigrationRecord,
  validateObservabilityEvidence,
  validateReadinessEvidence,
  validateRuntimeInputRecord,
} from "./resource-graph-runtime-validators";
import { collectRuntimeArtifactStatus } from "./resource-graph-runtime-artifacts";
import { collectServiceClientSelectionResources } from "./resource-graph-service-client";
import { isAdmittedControlPlaneRuntimeRecord } from "./resource-graph-types";
import type {
  DeploymentResourceInventoryEntry,
  DeploymentRuntimeInventorySources,
  RuntimeSourceRecord,
  RuntimeStatusRecord,
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
