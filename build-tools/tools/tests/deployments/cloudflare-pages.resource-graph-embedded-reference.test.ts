#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { REQUIRED_AWS_EC2_ALARMS } from "../../deployments/cloud-control-aws-ec2-host-profile";
import { cloudflareOwnedRuntimeEvidence } from "../../deployments/cloudflare-pages-runtime-owned-evidence";
import { snapshotRuntimeEvidenceReference } from "../../deployments/cloudflare-pages-resource-graph-runtime-reference";
import { runtimeEvidenceDocuments } from "../../deployments/resource-graph-runtime-evidence";
import {
  admitControlPlaneRuntimeRecord,
  type RuntimeSourceRecord,
} from "../../deployments/resource-graph-types";
import { evidence, IMAGE_BUILD_IDENTITY } from "./cloud-control-cutover-fixture";
import { runtimeInputProfile } from "./cloud-control-runtime-input.fixture";

const deploymentId = "sample-webapp-staging";
const snapshot = { submissionId: "cp-runtime-evidence", executionSnapshotPath: "/snap.json" };
const cases = [
  ["runtimeInputs", "cloud-control-runtime-input-reference@1"],
  ["authProviderProfiles", "auth-provider-profile-reference@1"],
  ["readinessEvidence", "control-plane-readiness-reference@1"],
  ["observabilityEvidence", "aws-ec2-control-plane-observability-reference@1"],
  ["miniMigrationEvidence", "mini-migration-preflight-reference@1"],
] as const;

test("embedded runtime evidence references validate every evidence kind", () => {
  for (const [key, schema] of cases) {
    const refs = {
      [key]: [source("embedded", embeddedReference(schema, key), validationFor(key))],
    };
    assert.equal(runtimeEvidenceDocuments(refs, { required: false }).length, 1);
  }
});

test("embedded runtime evidence references enforce authority identity", () => {
  assertInvalid({ controlPlaneProfileId: "other" }, /reference control-plane profile mismatch/);
  assertInvalid({ provider: "gcp" }, /reference provider mismatch/);
  assertInvalid(
    { resolvedEvidence: { ...runtimeInputProfile(), schemaVersion: "wrong" } },
    /resolved evidence runtime input schemaVersion invalid/,
  );
});

test("snapshot durable proof requires authority-validated owned evidence", () => {
  const ownedCheckedAt = new Date().toISOString();
  const valid = snapshotRuntimeEvidenceReference({
    value: {
      ...reference("cloud-control-runtime-input-reference@1", "runtimeInputs"),
      provider: "untrusted-metadata",
      checkedAt: "2020-01-01T00:00:00.000Z",
    },
    kind: "runtimeInputs",
    submissionId: snapshot.submissionId,
    deploymentId,
    evidenceKind: "RuntimeInput",
    evidenceSchemaVersion: "cloud-control-runtime-input@1",
    ownedEvidence: cloudflareOwnedRuntimeEvidence({
      evidenceKind: "RuntimeInput",
      deploymentId,
      checkedAt: ownedCheckedAt,
    }),
  });
  assert.match(String(valid.durableRecord.validatedEvidenceDigest), /^sha256:/);
  assert.equal(valid.durableRecord.provider, "aws-ec2");
  assert.equal(valid.durableRecord.validatedAt, ownedCheckedAt);
  assert.throws(
    () =>
      snapshotRuntimeEvidenceReference({
        value: reference("cloud-control-runtime-input-reference@1", "runtimeInputs"),
        kind: "runtimeInputs",
        submissionId: snapshot.submissionId,
        deploymentId,
        evidenceKind: "RuntimeInput",
        evidenceSchemaVersion: "cloud-control-runtime-input@1",
        ownedEvidence: { schemaVersion: "cloud-control-runtime-input@1", deploymentId },
      }),
    /owned evidence kind mismatch|runtime input/,
  );
  assert.throws(
    () =>
      snapshotRuntimeEvidenceReference({
        value: reference("cloud-control-runtime-input-reference@1", "runtimeInputs"),
        kind: "runtimeInputs",
        submissionId: snapshot.submissionId,
        deploymentId,
        evidenceKind: "RuntimeInput",
        evidenceSchemaVersion: "cloud-control-runtime-input@1",
        ownedEvidence: {
          ...cloudflareOwnedRuntimeEvidence({
            evidenceKind: "RuntimeInput",
            deploymentId,
            checkedAt: new Date().toISOString(),
          }),
          owningControlPlaneProfileId: "other",
        },
      }),
    /owned evidence control-plane profile mismatch/,
  );
});

function assertInvalid(overrides: Record<string, unknown>, error: RegExp) {
  assert.throws(
    () =>
      runtimeEvidenceDocuments(
        {
          runtimeInputs: [
            source("invalid", { ...embeddedReference(cases[0][1], cases[0][0]), ...overrides }),
          ],
        },
        { required: false },
      ),
    error,
  );
}

function source(
  id: string,
  value: unknown,
  overrides: Partial<RuntimeSourceRecord["validation"]> = {},
) {
  return admitControlPlaneRuntimeRecord({
    id,
    refs: [deploymentId],
    value,
    validation: {
      expectedCallbackHost: "deploy-auth.example.test",
      expectedCallbackPath: "/oidc/callback",
      deploymentIds: [deploymentId],
      production: true,
      maxAgeMinutes: 60,
      nowMs: Date.now(),
      operation: "cutover",
      expectedProvider: "aws-ec2",
      expectedControlPlaneProfileId: "cloudflare-pages-control-plane",
      runtimeEvidenceRecords: [],
      ...overrides,
    },
  });
}

function embeddedReference(schemaVersion: string, name: string) {
  return { ...reference(schemaVersion, name), resolvedEvidence: embeddedEvidenceFor(name) };
}

function reference(schemaVersion: string, name: string) {
  const evidenceRef = `evidence://control-plane/cloudflare-pages/snapshots/${snapshot.submissionId}/${name}`;
  return {
    schemaVersion,
    checkedAt: new Date().toISOString(),
    evidenceRef,
    provider: "aws-ec2",
    controlPlaneProfileId: "cloudflare-pages-control-plane",
    operation: name === "readinessEvidence" ? "cutover" : undefined,
    sourceSnapshot: snapshot,
  };
}

function embeddedEvidenceFor(name: string) {
  const input = runtimeInputProfile();
  return {
    runtimeInputs: input,
    authProviderProfiles: input.authProvider,
    readinessEvidence: evidence(),
    observabilityEvidence: observability(),
    miniMigrationEvidence: miniMigration(),
  }[name];
}

function validationFor(name: string) {
  return name === "readinessEvidence"
    ? { expectedHostProfile: "aws-ec2", expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY }
    : {};
}

function observability() {
  return {
    schemaVersion: "aws-ec2-control-plane-observability@1",
    checkedAt: new Date().toISOString(),
    provider: "aws-ec2",
    logSink: { kind: "cloudwatch", retentionDays: 30, accessControlDigest: "sha256:log-access" },
    unitLogRouting: { api: "deployment-control-plane-api.service" },
    history: { readiness: true, workerHeartbeat: true },
    alarms: REQUIRED_AWS_EC2_ALARMS.map((id) => ({ id, target: `alarm-${id}`, action: "notify" })),
  };
}

function miniMigration() {
  const checkedAt = new Date().toISOString();
  const tables = [
    "submissions",
    "queue",
    "control_plane_audit_events",
    "current_stage_state",
    "deploy_records",
    "idempotency",
  ];
  return {
    stateSync: { status: "passed", checkedAt },
    restore: { status: "passed", checkedAt, evidenceRef: "restore" },
    rollback: { status: "passed", checkedAt, evidenceRef: "rollback" },
    migratedRows: Object.fromEntries(tables.map((table) => [table, 1])),
  };
}
