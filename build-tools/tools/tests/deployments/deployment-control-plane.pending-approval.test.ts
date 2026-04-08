#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { readDeploymentControlPlaneStatus } from "../../deployments/deployment-control-plane-read.ts";
import { submitDeploymentControlPlaneRunAction } from "../../deployments/deployment-control-plane-run-action.ts";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>demoapp</html>\n", "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

test("pending approval submissions are observable and cancel idempotently before mutation", async () => {
  await runInTemp("deployment-control-plane-pending-approval", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      admissionPolicy: {
        ...nixosSharedHostDeploymentFixture().admissionPolicy,
        requiredApprovals: ["human/dev"],
      },
    });
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    let submissionPath = "";
    await assert.rejects(
      submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths: {
          statePath: path.join(tmp, "platform-state.json"),
          hostRoot: path.join(tmp, "host"),
          recordsRoot,
        },
      }),
      (error: any) => {
        submissionPath = String(error.submissionPath || "");
        assert.equal(
          error.submission.schemaVersion,
          "nixos-shared-host-control-plane-submission@2",
        );
        assert.equal(error.submission.lifecycleState, "pending_approval");
        assert.equal(error.submission.pendingReasonCode, "approval_required");
        assert.equal(error.submission.admission.decision, "pending_approval");
        return true;
      },
    );
    const status = await readDeploymentControlPlaneStatus({ submissionPath });
    assert.equal(status.schemaVersion, "deployment-control-plane-status@1");
    assert.equal(status.lifecycleState, "pending_approval");
    assert.equal(status.pendingReasonCode, "approval_required");
    const cancelled = await submitDeploymentControlPlaneRunAction({
      recordsRoot,
      submissionPath,
      action: "cancel",
      idempotencyKey: "cancel-approval-1",
    });
    assert.equal(cancelled.action, "cancel");
    assert.equal(cancelled.lifecycleState, "cancelled");
    assert.equal(cancelled.terminationReason, "cancelled");
    assert.equal(cancelled.latestAction?.dedupe.mode, "created");
    const cancelledAgain = await submitDeploymentControlPlaneRunAction({
      recordsRoot,
      submissionPath,
      action: "cancel",
      idempotencyKey: "cancel-approval-1",
    });
    assert.equal(cancelledAgain.lifecycleState, "cancelled");
    assert.equal(cancelledAgain.latestAction?.actionId, cancelled.actionId);
    assert.equal(cancelledAgain.latestAction?.dedupe.mode, "reused");
  });
});

test("resume fails closed for current non-resumable submissions", async () => {
  await runInTemp("deployment-control-plane-resume-not-resumable", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const submissionPath = path.join(
      recordsRoot,
      "control-plane",
      "submissions",
      "submission-1.json",
    );
    await fsp.mkdir(path.dirname(submissionPath), { recursive: true });
    await fsp.writeFile(
      submissionPath,
      JSON.stringify(
        {
          schemaVersion: "nixos-shared-host-control-plane-submission@2",
          submissionId: "submission-1",
          submittedAt: "2026-04-06T12:00:00.000Z",
          operationKind: "deploy",
          deploymentId: "demoapp-dev",
          deploymentLabel: "//projects/deployments/demoapp-dev:deploy",
          providerTargetIdentity: "nixos-shared-host:default:demoapp",
          lockScope: "nixos-shared-host:default:demoapp",
          executionSnapshotPath: "/tmp/execution-snapshot.json",
          lifecycleState: "finished",
          terminationReason: null,
          dedupe: { mode: "created", requestFingerprint: "sha256:submit" },
          admission: { decision: "admitted", reason: "shared_nonprod" },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const response = await submitDeploymentControlPlaneRunAction({
      recordsRoot,
      submissionPath,
      action: "resume",
      idempotencyKey: "resume-1",
    });
    assert.equal(response.action, "resume");
    assert.equal(response.lifecycleState, "finished");
    assert.equal(response.latestAction?.rejectionCode, "not_resumable");
  });
});
