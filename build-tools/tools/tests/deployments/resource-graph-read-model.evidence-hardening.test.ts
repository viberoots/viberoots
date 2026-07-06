#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAwsEc2ControlPlaneObservability } from "../../deployments/cloud-control-aws-ec2-observability";
import { REQUIRED_AWS_EC2_ALARMS } from "../../deployments/cloud-control-aws-ec2-host-profile";
import { syncBackendResourceGraphIndex } from "../../deployments/nixos-shared-host-control-plane-backend";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import {
  admitControlPlaneRuntimeRecord,
  type DeploymentRuntimeInventorySources,
  type RuntimeSourceRecord,
} from "../../deployments/resource-graph-types";
import { runInTemp } from "../lib/test-helpers";
import { evidence, IMAGE_BUILD_IDENTITY } from "./cloud-control-cutover-fixture";
import { runtimeInputProfile } from "./cloud-control-runtime-input.fixture";
import { backendFor } from "./resource-graph-read-model.runtime.fixture";
import { fixtureDocuments } from "./resource-graph-read-model.reconciliation-fixture";

const checkedAt = "2026-07-05T00:00:00.000Z";
const validation = {
  expectedCallbackHost: "deploy-auth.example.test",
  expectedCallbackPath: "/oidc/callback",
  deploymentIds: ["sample-webapp-staging"],
  production: true,
  maxAgeMinutes: 60,
  nowMs: Date.parse("2026-07-05T00:30:00.000Z"),
};

test("backend runtime evidence rows persist redacted documents", async () => {
  await runInTemp("resource-graph-runtime-evidence-redacted-db", async (tmp) => {
    const backend = backendFor(tmp);
    await syncBackendResourceGraphIndex(backend, {
      ...fixtureDocuments(),
      sourceRef: "workspace-resource-graph-export",
      runtimeSources: validSources(),
    });
    const rows = await queryBackend<{ document_json: unknown }>(
      backend,
      "SELECT document_json FROM resource_graph_runtime_evidence ORDER BY kind, name",
    );
    const stored = JSON.stringify(rows.rows.map((row) => row.document_json));
    assert.doesNotMatch(stored, /raw-secret|token=|Bearer/);
    assert.match(stored, /"<redacted>"/);
  });
});

test("observability validator rejects malformed field-present evidence", () => {
  const valid = observability();
  assert.deepEqual(validateAwsEc2ControlPlaneObservability(valid, validatorOptions()), []);
  for (const value of [
    { ...valid, schemaVersion: "aws-ec2-control-plane-observability@2" },
    { ...valid, checkedAt: "not-a-date" },
    { ...valid, provider: "manual-notes" },
    { ...valid, logSink: { kind: "cloudwatch" } },
    { ...valid, unitLogRouting: { api: "" } },
    { ...valid, unitLogRouting: { api: 123 } },
    { ...valid, history: { readiness: true, workerHeartbeat: "yes" } },
    {
      ...valid,
      alarms: REQUIRED_AWS_EC2_ALARMS.map((id) => ({ id, target: "", action: "" })),
    },
  ]) {
    assert.notDeepEqual(validateAwsEc2ControlPlaneObservability(value, validatorOptions()), []);
  }
});

test("backend importer rejects malformed field-present observability evidence", async () => {
  await runInTemp("resource-graph-runtime-evidence-observability-invalid", async (tmp) => {
    const backend = backendFor(tmp);
    await assert.rejects(
      () =>
        syncBackendResourceGraphIndex(backend, {
          ...fixtureDocuments(),
          sourceRef: "workspace-resource-graph-export",
          runtimeSources: {
            ...validSources(),
            observabilityEvidence: [
              source("observability", {
                ...observability(),
                logSink: { kind: "cloudwatch" },
                unitLogRouting: { api: "" },
                history: { readiness: true, workerHeartbeat: "yes" },
              }),
            ],
          },
        }),
      /AWS operational logs missing retention|unit log route api is malformed|worker-heartbeat history/,
    );
  });
});

function validSources(): DeploymentRuntimeInventorySources {
  const input = runtimeInputProfile();
  return {
    runtimeInputs: [source("runtime-input", input, ["demo-web"])],
    authProviderProfiles: [source("auth-profile", input.authProvider, ["demo-web"])],
    readinessEvidence: [
      source("cutover-readiness", evidence(), ["demo-web"], {
        expectedHostProfile: "aws-ec2",
        expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
        operation: "cutover",
      }),
    ],
    observabilityEvidence: [source("observability", observability(), ["demo-web"])],
    miniMigrationEvidence: [source("mini-migration", miniMigration(), ["demo-web"])],
  };
}

function source(
  id: string,
  value: unknown,
  refs: string[] = [],
  overrides: Partial<RuntimeSourceRecord["validation"]> = {},
) {
  return admitControlPlaneRuntimeRecord({
    id,
    refs,
    value,
    validation: { ...validation, ...overrides },
  });
}

function observability() {
  return {
    schemaVersion: "aws-ec2-control-plane-observability@1",
    checkedAt,
    provider: "aws-ec2",
    logSink: {
      kind: "cloudwatch",
      retentionDays: 30,
      accessControlDigest: "sha256:reviewed-log-access",
      token: "raw-secret",
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

function validatorOptions() {
  return {
    maxAgeMinutes: validation.maxAgeMinutes,
    nowMs: validation.nowMs,
    expectedProvider: "aws-ec2",
  };
}

function miniMigration() {
  return {
    stateSync: { status: "passed", checkedAt },
    restore: { status: "passed", checkedAt, evidenceRef: "r" },
    rollback: { status: "passed", checkedAt, evidenceRef: "b" },
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
