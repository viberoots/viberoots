#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { REQUIRED_AWS_EC2_ALARMS } from "../../deployments/cloud-control-aws-ec2-host-profile";
import { createDeploymentResourceEnvelopes } from "../../deployments/resource-graph-envelope";
import { createDeploymentResourceInventory } from "../../deployments/resource-graph-inventory";
import type {
  DeploymentResourceInventory,
  DeploymentRuntimeInventorySources,
  RuntimeSourceRecord,
} from "../../deployments/resource-graph-types";
import { admitControlPlaneRuntimeRecord } from "../../deployments/resource-graph-types";
import { IMAGE_BUILD_IDENTITY, evidence } from "./cloud-control-cutover-fixture";
import { runtimeInputProfile } from "./cloud-control-runtime-input.fixture";

test("runtime envelopes cover every admitted runtime fact kind", () => {
  const inventory = createDeploymentResourceInventory([], { runtimeSources: runtimeSources() });
  const result = createDeploymentResourceEnvelopes(inventory);
  assert.deepEqual(result.errors, []);
  for (const kind of runtimeKinds()) {
    const found = result.envelopes.find((item) => item.kind === kind);
    assert.ok(found, `${kind} envelope missing`);
    assert.equal(found.metadata.labels["viberoots.dev/authority"], "observed_runtime");
    assert.equal(found.source.class, "runtime");
    assert.equal(found.source.label, "admitted-control-plane-record");
    assert.equal(found.evidenceRef, `evidence:${found.metadata.uid}`);
    assert.equal(found.statusRef, `status:${found.metadata.uid}`);
  }
  assert.equal(JSON.stringify(result.envelopes).includes("raw-token"), false);
  const readiness = JSON.stringify(envelope(result, "ControlPlaneReadinessEvidence"));
  assert.equal(readiness.includes('"proof":"<redacted>"'), true);
});

test("runtime envelopes must derive from admitted runtime records", () => {
  const plainSources = createDeploymentResourceInventory([], {
    runtimeSources: {
      deployRuns: [
        { id: "plain-run", facts: { runId: "plain-run", deploymentId: "app", status: "passed" } },
      ],
    },
  });
  assert.match(plainSources.errors.join("\n"), /not an admitted control-plane record/);
  assert.equal(
    plainSources.resources.some((resource) => resource.kind === "DeployRun"),
    false,
  );

  const result = createDeploymentResourceEnvelopes({
    ...emptyInventory(),
    resources: [
      {
        kind: "DeployRun",
        id: "user-authored-run",
        authority: "observed_runtime",
        source: { class: "runtime" },
        facts: { runId: "user-authored-run", deploymentId: "app", status: "passed" },
      },
    ],
  });
  assert.match(result.errors.join("\n"), /must derive from admitted runtime records/);
});

function runtimeSources(): DeploymentRuntimeInventorySources {
  const input = runtimeInputProfile();
  return {
    runtimeInputs: [source("runtime-input", input)],
    authProviderProfiles: [source("auth-profile", input.authProvider)],
    readinessEvidence: [
      source("readiness", evidence(), {
        expectedHostProfile: "aws-ec2",
        expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
        maxAgeMinutes: 60,
        operation: "cutover",
      }),
    ],
    observabilityEvidence: [source("observability", observabilityProfile())],
    miniMigrationEvidence: [source("mini-migration", miniMigrationEvidence())],
    artifactChallenges: [status("challenge-1", challengeFacts())],
    staticWebappUploadSessions: [status("upload-1", uploadFacts())],
    artifactBindingProvenance: [status("binding-1", bindingFacts())],
    cleanupEvidence: [status("cleanup-1", cleanupFacts())],
    artifactCleanupJanitorRecords: [status("janitor-1", janitorFacts())],
    executionSnapshots: [
      status("snapshot-1", { snapshotId: "snapshot-1", deploymentId: "app", capturedAt: now }),
    ],
    deployRuns: [status("run-1", { runId: "run-1", deploymentId: "app", status: "passed" })],
    runActions: [status("action-1", { actionId: "action-1", runId: "run-1", status: "passed" })],
    currentStageStates: [
      status("app:staging", { deploymentId: "app", stage: "staging", state: "green" }),
    ],
    stageHistoryEntries: [
      status("history-1", { historyId: "history-1", deploymentId: "app", stage: "staging" }),
    ],
    auditEvents: [status("audit-1", { eventId: "audit-1", actor: "operator", action: "deploy" })],
    retainedEvidence: [status("evidence-1", { evidenceId: "evidence-1", digest: "sha256:e" })],
    controlPlaneRuntime: [
      status("runtime-1", { instanceId: "runtime-1", endpoint: "https://control", status: "up" }),
    ],
  };
}

const now = "2026-01-01T00:00:00.000Z";
const validation = {
  expectedCallbackHost: "deploy-auth.example.test",
  expectedCallbackPath: "/oidc/callback",
  deploymentIds: ["pleomino-staging"],
  production: true,
};

function runtimeKinds() {
  return [
    "ExecutionSnapshot",
    "DeployRun",
    "RunAction",
    "CurrentStageState",
    "RetainedEvidence",
    "StageHistoryEntry",
    "AuditEvent",
    "ArtifactChallenge",
    "StaticWebappUploadSession",
    "StagedArtifact",
    "ArtifactBindingProvenance",
    "CleanupEvidence",
    "ControlPlaneRuntime",
    "ControlPlaneReadinessEvidence",
    "RuntimeInput",
    "AuthProviderProfile",
    "ControlPlaneObservabilityEvidence",
    "MiniMigrationPreflightEvidence",
  ] as const;
}

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
    deploymentId: "app",
    proofKeyId: "proof-key-1",
    issuedAt: now,
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

const bindingFacts = () => ({
  challengeId: "challenge-1",
  proofKeyId: "proof-key-1",
  canonicalEnvelopeFingerprint: "sha256:envelope",
  admittedArtifactRef: "object://artifact-store/upload-1/archive.tar.gz",
  decision: "accepted",
});
const cleanupFacts = () => ({ recordId: "cleanup-1", status: "rejected", diagnostics: "expired" });
const observabilityProfile = () => ({
  schemaVersion: "aws-ec2-control-plane-observability@1",
  logSink: { kind: "cloudwatch" },
  unitLogRouting: { api: "deployment-control-plane-api.service" },
  history: { readiness: true, workerHeartbeat: true },
  alarms: REQUIRED_AWS_EC2_ALARMS.map((id) => ({ id, target: `alarm-${id}` })),
});
const miniMigrationEvidence = () => ({
  stateSync: { status: "passed", checkedAt: now },
  restore: { status: "passed", checkedAt: now, evidenceRef: "r" },
  rollback: { status: "passed", checkedAt: now, evidenceRef: "b" },
  migratedRows: {
    submissions: 1,
    queue: 1,
    control_plane_audit_events: 1,
    current_stage_state: 1,
    deploy_records: 1,
    idempotency: 1,
  },
});
const janitorFacts = () => ({
  recordId: "janitor-1",
  reason: "rejected-submission-cleanup",
  createdAt: now,
  documentJson: {
    schemaVersion: "nixos-shared-host-staged-artifact-janitor@1",
    reason: "rejected-submission-cleanup",
    stagedReference: {
      rootBasename: "staged-artifacts",
      basename: "upload-1",
      sha256: "a".repeat(64),
    },
    cleanupError: "cleanup failed",
  },
});

function envelope(result: ReturnType<typeof createDeploymentResourceEnvelopes>, kind: string) {
  const found = result.envelopes.find((item) => item.kind === kind);
  assert.ok(found, `${kind} envelope missing`);
  return found;
}

function emptyInventory(): DeploymentResourceInventory {
  return {
    taxonomyVersion: "deployment-resource-taxonomy@1",
    resources: [],
    errors: [],
    graphRead: { providerIndexAvailable: false, nodeLockIndexAvailable: false },
    workspace: {
      supportedDeploymentQueryRoots: [],
      projectConfig: {
        sharedPath: "",
        localPath: "",
        localPresent: false,
        disallowLocalOverrides: false,
        redactedOverrides: [],
      },
    },
  };
}
