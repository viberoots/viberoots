#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeploymentResourceInventory } from "../../deployments/resource-graph-inventory";
import type { DeploymentRuntimeInventorySources } from "../../deployments/resource-graph-types";
import {
  admitControlPlaneRuntimeRecord,
  type RuntimeSourceRecord,
} from "../../deployments/resource-graph-types";
import { REQUIRED_AWS_EC2_ALARMS } from "../../deployments/cloud-control-aws-ec2-host-profile";
import { IMAGE_BUILD_IDENTITY, evidence } from "./cloud-control-cutover-fixture";
import { runtimeInputProfile } from "./cloud-control-runtime-input.fixture";

const validation = {
  expectedCallbackHost: "deploy-auth.example.test",
  expectedCallbackPath: "/oidc/callback",
  deploymentIds: ["sample-webapp-staging"],
  production: true,
  maxAgeMinutes: 60,
  nowMs: Date.parse("2026-01-01T00:30:00.000Z"),
};

function kindSet(sources: DeploymentRuntimeInventorySources) {
  const inventory = createDeploymentResourceInventory([], { runtimeSources: sources });
  assert.deepEqual(inventory.errors, []);
  return new Set(inventory.resources.map((resource) => resource.kind));
}

test("runtime inventory validates and preserves reviewed runtime evidence objects", () => {
  const input = runtimeInputProfile();
  const inventory = createDeploymentResourceInventory([], {
    runtimeSources: {
      runtimeInputs: [source("runtime-input", input)],
      authProviderProfiles: [source("auth-profile", input.authProvider)],
      readinessEvidence: [
        source("cutover-readiness", evidence(), {
          expectedHostProfile: "aws-ec2",
          expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
          maxAgeMinutes: 60,
          operation: "cutover",
        }),
      ],
      observabilityEvidence: [source("observability", observabilityProfile())],
      miniMigrationEvidence: [source("mini-migration", miniMigrationEvidence())],
    },
  });
  assert.deepEqual(inventory.errors, []);
  const runtimeInput = inventory.resources.find((resource) => resource.kind === "RuntimeInput");
  assert.deepEqual(runtimeInput?.facts?.value, input);
  const seen = new Set(inventory.resources.map((resource) => resource.kind));
  assert.equal(seen.has("AuthProviderProfile"), true);
  assert.equal(seen.has("ControlPlaneReadinessEvidence"), true);
  assert.equal(seen.has("ControlPlaneObservabilityEvidence"), true);
  assert.equal(seen.has("MiniMigrationPreflightEvidence"), true);
});

test("runtime inventory covers current control-plane state concepts", () => {
  const seen = kindSet({
    artifactChallenges: [status("challenge-1", challengeFacts())],
    staticWebappUploadSessions: [status("upload-1", uploadFacts())],
    artifactBindingProvenance: [status("binding-1", bindingFacts())],
    cleanupEvidence: [
      status("cleanup-1", {
        recordId: "cleanup-1",
        status: "rejected",
        diagnostics: "upload session expired before admission",
      }),
    ],
    executionSnapshots: [
      status("snapshot-1", {
        snapshotId: "snapshot-1",
        deploymentId: "sample-webapp-staging",
        capturedAt: "2026-01-01T00:00:00.000Z",
      }),
    ],
    deployRuns: [
      status("run-1", { runId: "run-1", deploymentId: "sample-webapp", status: "passed" }),
    ],
    runActions: [status("action-1", { actionId: "action-1", runId: "run-1", status: "passed" })],
    currentStageStates: [
      status("sample-webapp:staging", {
        deploymentId: "sample-webapp",
        stage: "staging",
        state: "green",
      }),
    ],
    stageHistoryEntries: [
      status("history-1", {
        historyId: "history-1",
        deploymentId: "sample-webapp",
        stage: "staging",
      }),
    ],
    auditEvents: [status("audit-1", { eventId: "audit-1", actor: "operator", action: "deploy" })],
    retainedEvidence: [status("evidence-1", { evidenceId: "evidence-1", digest: "sha256:e" })],
    controlPlaneRuntime: [
      status("runtime-1", { instanceId: "runtime-1", endpoint: "https://control", status: "up" }),
    ],
  });
  for (const expected of [
    "ArtifactChallenge",
    "StaticWebappUploadSession",
    "StagedArtifact",
    "ArtifactBindingProvenance",
    "CleanupEvidence",
    "ExecutionSnapshot",
    "DeployRun",
    "RunAction",
    "CurrentStageState",
    "StageHistoryEntry",
    "AuditEvent",
    "RetainedEvidence",
    "ControlPlaneRuntime",
  ]) {
    assert.equal(seen.has(expected as never), true, expected);
  }
});

test("runtime inventory rejects secret-bearing runtime status records", () => {
  const inventory = createDeploymentResourceInventory([], {
    runtimeSources: {
      artifactChallenges: [status("challenge-1", { ...challengeFacts(), nonce: "raw" })],
    },
  });
  assert.match(inventory.errors.join("\n"), /forbidden secret fields nonce/);
});

test("runtime inventory requires full challenge and upload artifact provenance", () => {
  const inventory = createDeploymentResourceInventory([], {
    runtimeSources: {
      artifactChallenges: [
        status("challenge-1", {
          ...challengeFacts(),
          oneTimeConsumption: "",
          failureDiagnostics: "",
          status: "rejected",
        }),
      ],
      staticWebappUploadSessions: [
        status("upload-1", { ...uploadFacts(), provenance: "manual:upload-1", sizeBytes: "" }),
      ],
    },
  });
  const errors = inventory.errors.join("\n");
  assert.match(errors, /missing oneTimeConsumption/);
  assert.match(errors, /rejected challenge requires failureDiagnostics/);
  assert.match(errors, /missing sizeBytes/);
  assert.match(errors, /provenance must be upload-session:<id>/);
});

function status(id: string, facts: Record<string, unknown>) {
  return admitControlPlaneRuntimeRecord({ id, facts });
}

function source(
  id: string,
  value: unknown,
  validationOverrides: Partial<RuntimeSourceRecord["validation"]> = {},
) {
  return admitControlPlaneRuntimeRecord({
    id,
    value,
    validation: { ...validation, ...validationOverrides },
  });
}

function challengeFacts() {
  return {
    challengeId: "challenge-1",
    deploymentId: "sample-webapp",
    proofKeyId: "proof-key-1",
    issuedAt: "2026-01-01T00:00:00.000Z",
    nonceValidationOutcome: "matched-redacted-nonce-digest",
    proofKeyValidationOutcome: "trusted-key",
    oneTimeConsumption: "consumed-once",
    admittedProvenance: "artifact-binding:binding-1",
    status: "accepted",
  };
}

function uploadFacts() {
  return {
    uploadSessionId: "upload-1",
    submissionId: "submission-1",
    archiveFormat: "tar.gz",
    archivePath: "uploads/upload-1/archive.tar.gz",
    objectIdentity: "object://artifact-store/upload-1/archive.tar.gz",
    digest: "sha256:artifact",
    sizeBytes: 42,
    expiresAt: "2026-01-01T00:05:00.000Z",
    provenance: "upload-session:upload-1",
  };
}

function bindingFacts() {
  return {
    challengeId: "challenge-1",
    proofKeyId: "proof-key-1",
    canonicalEnvelopeFingerprint: "sha256:envelope",
    admittedArtifactRef: "object://artifact-store/upload-1/archive.tar.gz",
    decision: "accepted",
  };
}

function observabilityProfile() {
  return {
    schemaVersion: "aws-ec2-control-plane-observability@1",
    checkedAt: "2026-01-01T00:00:00.000Z",
    provider: "aws-ec2",
    logSink: {
      kind: "cloudwatch",
      retentionDays: 30,
      accessControlDigest: "sha256:reviewed-log-access",
    },
    unitLogRouting: { api: "deployment-control-plane-api.service" },
    history: { readiness: true, workerHeartbeat: true },
    alarms: REQUIRED_AWS_EC2_ALARMS.map((id) => ({
      id,
      target: `alarm-${id}`,
      action: "reviewed-notification-hook",
    })),
  };
}

function miniMigrationEvidence() {
  return {
    stateSync: { status: "passed", checkedAt: "2026-01-01T00:00:00.000Z" },
    restore: { status: "passed", checkedAt: "2026-01-01T00:00:00.000Z", evidenceRef: "r" },
    rollback: { status: "passed", checkedAt: "2026-01-01T00:00:00.000Z", evidenceRef: "b" },
    migratedRows: {
      submissions: 1,
      queue: 1,
      control_plane_audit_events: 1,
      current_stage_state: 1,
      deploy_records: 1,
      idempotency: 1,
    },
  };
}
