#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA } from "../../deployments/deployment-control-plane-contract";
import { writeBackendControlPlaneRunActionFailureAuditEvent } from "../../deployments/deployment-control-plane-audit";
import { handleControlPlaneRunActionService } from "../../deployments/deployment-control-plane-run-action-service";
import {
  localHarnessControlPlaneDatabaseUrl,
  readBackendControlPlaneAuditEvents,
  readBackendSubmissionBySubmissionId,
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import { runInTemp } from "../lib/test-helpers";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";
import type { NixosSharedHostDeployment } from "../../deployments/contract";

function backend(recordsRoot: string) {
  return { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
}

async function assertNoPath(filePath: string) {
  await assert.rejects(fsp.access(filePath));
}

async function seedPausedProgressiveSubmission(
  recordsRoot: string,
  submissionId: string,
  deployment: NixosSharedHostDeployment = nixosSharedHostDeploymentFixture(),
) {
  const db = backend(recordsRoot);
  const executionSnapshotPath = path.join(recordsRoot, "snapshots", `${submissionId}.json`);
  const submissionPath = path.join(recordsRoot, "submissions", `${submissionId}.json`);
  await writeBackendSnapshotDoc(
    db,
    {
      submissionId,
      operationKind: "deploy",
      deployment,
    },
    executionSnapshotPath,
  );
  await writeBackendSubmissionDoc(
    db,
    {
      submissionId,
      submittedAt: "2026-05-01T10:00:00.000Z",
      deploymentId: "demoapp-dev",
      deploymentLabel: "//deployments/demoapp:dev",
      operationKind: "deploy",
      providerTargetIdentity: "nixos-shared-host:default:demoapp",
      lockScope: "nixos-shared-host:default:demoapp",
      executionSnapshotPath,
      lifecycleState: "paused",
      deployRunId: "deploy-progressive-paused",
      progressiveRollout: {
        strategy: "manual",
        state: "paused",
        resumable: true,
        componentResults: [],
      },
      dedupe: { mode: "created", requestFingerprint: "sha256:submit" },
    },
    { submissionPath, executionSnapshotPath },
  );
  return db;
}

test("backend service fails progressive resume and abort closed without local coordination", async () => {
  await runInTemp("control-plane-progressive-backend-run-action", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const db = await seedPausedProgressiveSubmission(recordsRoot, "cp-progressive-paused");
    for (const action of ["resume", "abort"] as const) {
      await assert.rejects(
        handleControlPlaneRunActionService(
          {
            schemaVersion: DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA,
            actionId: `${action}-progressive`,
            submittedAt:
              action === "resume" ? "2026-05-01T10:01:00.000Z" : "2026-05-01T10:02:00.000Z",
            submissionId: "cp-progressive-paused",
            action,
            idempotencyKey: `${action}-progressive`,
            requestedBy: { principalId: "user:progressive-operator" },
          },
          { backend: db, workspaceRoot: tmp },
        ),
        /backend control-plane service does not support progressive/,
      );
    }
    const submission = (await readBackendSubmissionBySubmissionId(
      db,
      "cp-progressive-paused",
    )) as any;
    assert.equal(submission.lifecycleState, "paused");
    assert.equal(submission.deployRunId, "deploy-progressive-paused");
    assert.equal(
      (await queryBackend<{ count: string }>(db, "SELECT COUNT(*)::text AS count FROM run_actions"))
        .rows[0]?.count,
      "2",
    );
    await assertNoPath(path.join(recordsRoot, "control-plane", "locks"));
    await assertNoPath(path.join(recordsRoot, "control-plane", "run-actions"));
    await assertNoPath(path.join(recordsRoot, "runs"));
    const audit = (await readBackendControlPlaneAuditEvents(db, "demoapp-dev")).filter(
      (event) => event.result === "failed",
    );
    assert.deepEqual(
      audit.map((event) => ({
        requestId: event.requestId,
        actor: event.actor,
        operation: event.operation,
        idempotencyKey: event.idempotencyKey,
        deploymentId: event.deploymentId,
        result: event.result,
      })),
      [
        {
          requestId: "resume-progressive",
          actor: "user:progressive-operator",
          operation: "resume",
          idempotencyKey: "resume-progressive",
          deploymentId: "demoapp-dev",
          result: "failed",
        },
        {
          requestId: "abort-progressive",
          actor: "user:progressive-operator",
          operation: "abort",
          idempotencyKey: "abort-progressive",
          deploymentId: "demoapp-dev",
          result: "failed",
        },
      ],
    );
    assert.ok(
      audit.every((event) =>
        event.failureSummary?.includes("backend_progressive_run_action_unsupported"),
      ),
    );
  });
});

test("backend service audits authorization failures after deployment context is loaded", async () => {
  await runInTemp("control-plane-run-action-auth-audit", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const protectedDeployment = {
      ...nixosSharedHostDeploymentFixture(),
      vaultRuntime: {
        oidcIssuer: "https://identity.example.test/realms/deployments",
        audience: "vault",
        addr: "https://vault.example.test",
      },
    } as NixosSharedHostDeployment;
    const db = await seedPausedProgressiveSubmission(
      recordsRoot,
      "cp-auth-required",
      protectedDeployment,
    );
    await assert.rejects(
      handleControlPlaneRunActionService(
        {
          schemaVersion: DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA,
          actionId: "cancel-without-session",
          submittedAt: "2026-05-01T10:03:00.000Z",
          submissionId: "cp-auth-required",
          action: "cancel",
          idempotencyKey: "cancel-without-session",
        },
        { backend: db, workspaceRoot: tmp },
      ),
      /auth-required run actions require authSessionId/,
    );
    const audit = (await readBackendControlPlaneAuditEvents(db, "demoapp-dev")).find(
      (event) => event.requestId === "cancel-without-session",
    );
    assert.equal(audit?.actor, "service:deployment-control-plane");
    assert.equal(audit?.operation, "cancel");
    assert.equal(audit?.idempotencyKey, "cancel-without-session");
    assert.equal(audit?.deploymentId, "demoapp-dev");
    assert.equal(audit?.result, "failed");
    assert.equal(
      audit?.failureSummary,
      "unauthorized: auth-required run actions require authSessionId",
    );
  });
});

test("backend run-action failure audit redacts secret-bearing summaries", async () => {
  await runInTemp("control-plane-run-action-secret-audit", async (tmp) => {
    const db = backend(path.join(tmp, "records"));
    await writeBackendControlPlaneRunActionFailureAuditEvent({
      client: {
        query: async <T extends Record<string, unknown> = Record<string, unknown>>(
          sql: string,
          params?: readonly unknown[],
        ) => await queryBackend<T>(db, sql, params),
      },
      requestId: "redaction-failure",
      actor: "user:operator",
      operation: "resume",
      idempotencyKey: "redaction-key",
      deploymentId: "demoapp-dev",
      failureSummary: "resume failed with token=super-secret-api-key",
      occurredAt: "2026-05-01T10:04:00.000Z",
    });
    const audit = (await readBackendControlPlaneAuditEvents(db, "demoapp-dev"))[0];
    assert.equal(audit?.requestId, "redaction-failure");
    assert.equal(audit?.result, "failed");
    assert.match(audit?.failureSummary || "", /sensitive payload redacted/);
    assert.ok(!JSON.stringify(audit).includes("super-secret-api-key"));
  });
});
