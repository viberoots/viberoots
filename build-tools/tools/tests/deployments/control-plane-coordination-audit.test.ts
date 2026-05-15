#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { prepareBackendNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane-backend-prepare";
import {
  localHarnessControlPlaneDatabaseUrl,
  readBackendControlPlaneAuditEvents,
  writeBackendSubmissionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";
import { runInTemp } from "../lib/test-helpers";

test("durable audit events include request identity and non-secret failure summary", async () => {
  await runInTemp("control-plane-audit-fields", async (tmp) => {
    const backend = { recordsRoot: tmp, databaseUrl: localHarnessControlPlaneDatabaseUrl(tmp) };
    await writeBackendSubmissionDoc(
      backend,
      {
        submissionId: "cp-audit",
        submittedAt: "2026-05-01T10:00:00.000Z",
        deploymentId: "demoapp-dev",
        operationKind: "deploy",
        lockScope: "scope",
        executionSnapshotPath: "snapshot",
        lifecycleState: "cancelled",
        terminationReason: "cancelled",
        latestAction: {
          actionId: "cancel-1",
          action: "cancel",
          submittedAt: "2026-05-01T10:01:00.000Z",
          requestedBy: { principalId: "user:operator" },
          rejectionCode: "not_paused",
          dedupe: { idempotencyKey: "cancel-key-1" },
        },
      },
      { submissionPath: "submission", executionSnapshotPath: "snapshot" },
    );
    await writeBackendSubmissionDoc(
      backend,
      {
        submissionId: "cp-rejected",
        submittedAt: "2026-05-01T10:02:00.000Z",
        deploymentId: "demoapp-dev",
        operationKind: "deploy",
        lockScope: "scope",
        executionSnapshotPath: "snapshot",
        lifecycleState: "finished",
        rejectionCode: "no_longer_admitted",
        rejectionMessage: "prerequisite deployment has no admitted run",
      },
      { submissionPath: "rejected", executionSnapshotPath: "snapshot" },
    );
    await writeBackendSubmissionDoc(
      backend,
      {
        submissionId: "cp-success",
        submittedAt: "2026-05-01T10:03:00.000Z",
        deploymentId: "demoapp-dev",
        operationKind: "deploy",
        lockScope: "scope",
        executionSnapshotPath: "snapshot",
        lifecycleState: "finished",
        finalOutcome: "succeeded",
        requestedBy: { principalId: "user:submitter" },
        dedupe: { idempotencyKey: "submit-success" },
      },
      { submissionPath: "success", executionSnapshotPath: "snapshot" },
    );
    const events = await readBackendControlPlaneAuditEvents(backend, "demoapp-dev");
    const cancel = events.find((event) => event.requestId === "cancel-1");
    assert.equal(cancel?.actor, "user:operator");
    assert.equal(cancel?.operation, "cancel");
    assert.equal(cancel?.idempotencyKey, "cancel-key-1");
    assert.equal(cancel?.failureSummary, "not_paused");
    assert.equal(
      events.find((event) => event.requestId === "cp-rejected")?.failureSummary,
      "no_longer_admitted: prerequisite deployment has no admitted run",
    );
    const success = events.find((event) => event.requestId === "cp-success");
    assert.equal(success?.actor, "user:submitter");
    assert.equal(success?.operation, "deploy");
    assert.equal(success?.idempotencyKey, "submit-success");
    assert.equal(success?.deploymentId, "demoapp-dev");
    assert.equal(success?.result, "succeeded");
    const rows = await queryBackend<{ document_json?: unknown }>(
      backend,
      "SELECT document_json FROM control_plane_audit_events WHERE deployment_id = $1",
      ["demoapp-dev"],
    );
    assert.equal(rows.rows.length, 3);
  });
});

test("nixos backend admission rejection persists a sanitized message for audit summaries", async () => {
  await runInTemp("control-plane-audit-nixos-admission-message", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const backend = {
      recordsRoot: paths.recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    };
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    let submission: any;
    await assert.rejects(
      prepareBackendNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        paths,
        backend,
        artifactDir,
        expectedArtifactIdentity: "static-webapp:stale-admission",
        dedupe: {
          mode: "created",
          requestFingerprint: "sha256:submit-rejected",
          idempotencyKey: "submit-rejected",
        },
      }),
      (error: any) => {
        submission = error.submission;
        return /challenged expected identity/.test(error.message);
      },
    );
    assert.equal(submission?.rejectionCode, "no_longer_admitted");
    assert.equal(
      submission?.rejectionMessage,
      "admitted artifact identity does not match the challenged expected identity",
    );
    const events = await readBackendControlPlaneAuditEvents(backend, deployment.deploymentId);
    assert.equal(
      events.find((event) => event.requestId === submission.submissionId)?.failureSummary,
      "no_longer_admitted: admitted artifact identity does not match the challenged expected identity",
    );
  });
});
