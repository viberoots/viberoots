#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { readDeploymentControlPlaneStatus } from "../../deployments/deployment-control-plane-read.ts";
import { approvalGrantPathFor } from "../../deployments/deployment-control-plane-approval.ts";
import { statusFromSubmission } from "../../deployments/deployment-control-plane-status.ts";
import { executeSubmittedNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane-submit-helpers.ts";
import {
  readControlPlaneJson,
  writeControlPlaneJson,
} from "../../deployments/nixos-shared-host-control-plane-store.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  approvePendingRun,
  pendingApprovalRun,
  requiredApprovalDeployment,
} from "./deployment-control-plane.approval-grant.helpers.ts";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture.ts";
import { smokeConnectOverride } from "./nixos-shared-host.control-plane.helpers.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

test("approve advances a pending run on the same deployRunId and executes that run", async () => {
  await runInTemp("deployment-control-plane-approval-grant", async (tmp, $) => {
    const deployment = requiredApprovalDeployment();
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: path.join(tmp, "host"),
    });
    const admissionEvidence = reviewedLaneAdmissionEvidenceFixture({ deployment });
    try {
      const pending = await pendingApprovalRun(
        tmp,
        $,
        deployment,
        smokeConnectOverride(server.port),
        admissionEvidence,
      );
      assert.equal(pending.submission.approval?.state, "pending");
      assert.ok(pending.submission.deployRunId);
      const approved = await approvePendingRun({
        workspaceRoot: tmp,
        pending,
        idempotencyKey: "approve-pending-1",
        requestedBy: { principalId: "user:reviewer" },
        approval: {
          approvalId: "ticket-123",
          expectedPayloadFingerprint: pending.submission.approval.payloadFingerprint,
          expectedProvisionerPlanFingerprint:
            pending.submission.approval.provisionerPlanFingerprint,
        },
      });
      assert.equal(approved.lifecycleState, "waiting_for_lock");
      assert.equal(approved.deployRunId, pending.submission.deployRunId);
      assert.equal(approved.approval?.state, "granted");
      assert.equal(approved.latestAction?.action, "approve");
      const approvedAgain = await approvePendingRun({
        workspaceRoot: tmp,
        pending,
        idempotencyKey: "approve-pending-1",
        requestedBy: { principalId: "user:reviewer" },
        approval: {
          approvalId: "ticket-123",
          expectedPayloadFingerprint: pending.submission.approval.payloadFingerprint,
          expectedProvisionerPlanFingerprint:
            pending.submission.approval.provisionerPlanFingerprint,
        },
      });
      assert.equal(approvedAgain.deployRunId, pending.submission.deployRunId);
      assert.equal(approvedAgain.latestAction?.dedupe.mode, "reused");
      const submission = await readControlPlaneJson<any>(pending.submissionPath);
      const snapshot = await readControlPlaneJson<any>(pending.executionSnapshotPath);
      const executed = await executeSubmittedNixosSharedHostControlPlaneRun({
        submission,
        submissionPath: pending.submissionPath,
        executionSnapshotPath: pending.executionSnapshotPath,
        snapshot,
        workspaceRoot: tmp,
        deployRunId: submission.deployRunId,
        recordsRoot: pending.recordsRoot,
        operationKind: snapshot.operationKind,
        deployment: snapshot.deployment,
      });
      assert.equal(executed.submission.lifecycleState, "finished");
      assert.equal(executed.submission.deployRunId, pending.submission.deployRunId);
      assert.equal(executed.result.record.deployRunId, pending.submission.deployRunId);
      assert.equal(
        executed.result.record.admittedContext.policyEvaluation.requiredApprovals[0]?.approver
          ?.principalId,
        "user:reviewer",
      );
    } finally {
      await server.close();
    }
  });
});

test("approve rejects self-approval and stale payload bindings without mutating the run", async () => {
  await runInTemp("deployment-control-plane-approval-rejections", async (tmp, $) => {
    const deployment = requiredApprovalDeployment();
    const pending = await pendingApprovalRun(
      tmp,
      $,
      deployment,
      undefined,
      reviewedLaneAdmissionEvidenceFixture({ deployment }),
    );
    const selfApproved = await approvePendingRun({
      workspaceRoot: tmp,
      pending,
      idempotencyKey: "self-approve-1",
      requestedBy: pending.submission.requestedBy,
      approval: {
        expectedPayloadFingerprint: pending.submission.approval.payloadFingerprint,
      },
    });
    assert.equal(selfApproved.lifecycleState, "pending_approval");
    assert.equal(selfApproved.latestAction?.rejectionCode, "unauthorized");
    const stale = await approvePendingRun({
      workspaceRoot: tmp,
      pending,
      idempotencyKey: "stale-approve-1",
      requestedBy: { principalId: "user:reviewer" },
      approval: {
        expectedPayloadFingerprint: "sha256:stale",
      },
    });
    assert.equal(stale.lifecycleState, "pending_approval");
    assert.equal(stale.latestAction?.rejectionCode, "approval_no_longer_valid");
  });
});

test("revoked approval fails closed before mutation begins", async () => {
  await runInTemp("deployment-control-plane-approval-revoked", async (tmp, $) => {
    const deployment = requiredApprovalDeployment();
    const pending = await pendingApprovalRun(
      tmp,
      $,
      deployment,
      undefined,
      reviewedLaneAdmissionEvidenceFixture({ deployment }),
    );
    const approved = await approvePendingRun({
      workspaceRoot: tmp,
      pending,
      idempotencyKey: "approve-before-revoke-1",
      requestedBy: { principalId: "user:reviewer" },
      approval: {
        approvalId: "ticket-revoke",
        expectedPayloadFingerprint: pending.submission.approval.payloadFingerprint,
      },
    });
    const submission = await readControlPlaneJson<any>(pending.submissionPath);
    const snapshot = await readControlPlaneJson<any>(pending.executionSnapshotPath);
    await assert.rejects(
      executeSubmittedNixosSharedHostControlPlaneRun({
        submission,
        submissionPath: pending.submissionPath,
        executionSnapshotPath: pending.executionSnapshotPath,
        snapshot,
        workspaceRoot: tmp,
        deployRunId: submission.deployRunId,
        recordsRoot: pending.recordsRoot,
        operationKind: snapshot.operationKind,
        deployment: snapshot.deployment,
        onLockAcquired: async () => {
          const approvalRecordPath = approvalGrantPathFor(
            pending.recordsRoot,
            String(approved.approval?.approvalId),
          );
          const record = await readControlPlaneJson<any>(approvalRecordPath);
          await writeControlPlaneJson(approvalRecordPath, {
            ...record,
            status: "revoked",
          });
        },
      }),
      (error: any) => {
        assert.equal(error.code, "approval_no_longer_valid");
        assert.equal(error.submission.lifecycleState, "finished");
        assert.equal(error.submission.terminationReason, "no_longer_admitted");
        assert.equal(error.submission.approval?.state, "no_longer_valid");
        return true;
      },
    );
    await assert.rejects(
      readDeploymentControlPlaneStatus({
        submissionPath: pending.submissionPath,
      }),
      /no longer accepts --submission-path/,
    );
    const status = statusFromSubmission(await readControlPlaneJson<any>(pending.submissionPath));
    assert.equal(status.approval?.state, "no_longer_valid");
    assert.equal(status.terminationReason, "no_longer_admitted");
  });
});
