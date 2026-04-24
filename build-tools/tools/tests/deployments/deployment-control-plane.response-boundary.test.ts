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
    authorizationSnapshot: {
      requestedBy: {
        principalId: "user:submitter",
        displayName: "Submitter",
        secretToken: "should-not-leak",
      },
      grants: [
        { role: "submitter", scope: { kind: "project", value: "projects/deployments/demoapp" } },
        {
          role: "admission_reporter",
          scope: { kind: "admission_domain", value: "all_deployments", wildcard: "*" },
        },
        { role: "submitter", scope: { kind: "project", value: "projects/deployments/demoapp" } },
      ],
    },
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
    latestAction: {
      actionId: "approve-1",
      action: "approve",
      submittedAt: "2026-04-16T12:02:00.000Z",
      dedupe: { mode: "created" as const, requestFingerprint: "sha256:approve" },
      lifecycleState: "pending_approval" as const,
      requestedBy: { principalId: "user:reviewer" },
      authorizationSnapshot: {
        requestedBy: { principalId: "user:reviewer", apiKey: "nope" },
        grants: [
          { role: "approver", scope: { kind: "environment_stage", value: "dev", noisy: true } },
          { role: "approver", scope: { kind: "environment_stage", value: "dev" } },
        ],
      },
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

function assertPublicAuthorizationBoundary(response: {
  authorizationSnapshot?: {
    requestedBy: { principalId: string; secretToken?: string };
    grants: Array<{ role: string; scope: { kind: string; value: string; wildcard?: string } }>;
  };
  latestAction?: {
    authorizationSnapshot?: {
      requestedBy: { principalId: string; apiKey?: string };
      grants: Array<{ scope: { kind: string; value: string; noisy?: boolean } }>;
    };
  };
}) {
  assert.deepEqual(response.authorizationSnapshot?.grants, [
    { role: "submitter", scope: { kind: "project", value: "projects/deployments/demoapp" } },
    { role: "admission_reporter", scope: { kind: "admission_domain", value: "all_deployments" } },
  ]);
  assert.ok(!("secretToken" in (response.authorizationSnapshot?.requestedBy || {})));
  assert.ok(!("wildcard" in (response.authorizationSnapshot?.grants[1]?.scope || {})));
  assert.deepEqual(response.latestAction?.authorizationSnapshot?.grants, [
    { role: "approver", scope: { kind: "environment_stage", value: "dev" } },
  ]);
  assert.ok(!("apiKey" in (response.latestAction?.authorizationSnapshot?.requestedBy || {})));
  assert.ok(!("noisy" in (response.latestAction?.authorizationSnapshot?.grants[0]?.scope || {})));
}

test("submit, status, and run-action responses strip approval-record paths from nested approval summaries", () => {
  const submission = submissionWithLeakedApprovalPath() as any;

  const submit = submitResponseFromSubmission(submission);
  const status = statusFromSubmission(submission);
  const action = runActionResponseFromSubmission(submission, "approve-1", "approve");

  assertPublicApprovalBoundary(submit);
  assertPublicApprovalBoundary(status);
  assertPublicApprovalBoundary(action);
  assertPublicAuthorizationBoundary(submit);
  assertPublicAuthorizationBoundary(status);
  assertPublicAuthorizationBoundary(action);
});
