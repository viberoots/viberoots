#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runActionResponseFromSubmission,
  statusFromSubmission,
  submitResponseFromSubmission,
} from "../../deployments/deployment-control-plane-status.ts";

function submissionWithLeakedApprovalPath() {
  return {
    submissionId: "submission-1",
    submittedAt: "2026-04-16T12:00:00.000Z",
    deploymentId: "demoapp-dev",
    deploymentLabel: "//projects/deployments/demoapp-dev:deploy",
    operationKind: "deploy",
    providerTargetIdentity: "nixos-shared-host:shared-nonprod:demoapp-dev",
    lockScope: "nixos-shared-host:shared-nonprod:demoapp-dev",
    lifecycleState: "pending_approval" as const,
    terminationReason: null,
    dedupe: { mode: "created" as const, requestFingerprint: "sha256:submit" },
    approval: {
      state: "granted" as const,
      approvalNames: ["human/dev"],
      payloadFingerprint: "sha256:payload",
      targetIdentity: "nixos-shared-host:shared-nonprod:demoapp-dev",
      approvalId: "ticket-123",
      grantedAt: "2026-04-16T12:01:00.000Z",
      approvalRecordPath: "/tmp/records/control-plane/approvals/ticket-123.json",
      approver: { principalId: "user:reviewer", displayName: "Reviewer" },
    },
  };
}

function assertPublicApprovalBoundary(response: {
  approval?: {
    approvalRecordPath?: string;
    approvalId?: string;
    approver?: { principalId: string };
  };
}) {
  const approval = response.approval;
  assert.ok(approval);
  assert.equal(approval.approvalId, "ticket-123");
  assert.equal(approval.approver?.principalId, "user:reviewer");
  assert.ok(!("approvalRecordPath" in approval));
}

test("submit, status, and run-action responses strip approval-record paths from nested approval summaries", () => {
  const submission = submissionWithLeakedApprovalPath() as any;

  assertPublicApprovalBoundary(submitResponseFromSubmission(submission));
  assertPublicApprovalBoundary(statusFromSubmission(submission));
  assertPublicApprovalBoundary(runActionResponseFromSubmission(submission, "approve-1", "approve"));
});
