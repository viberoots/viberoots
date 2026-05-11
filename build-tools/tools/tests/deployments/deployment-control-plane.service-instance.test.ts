#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  statusFromSubmission,
  submitResponseFromSubmission,
} from "../../deployments/deployment-control-plane-status";
import { formatDeploymentControlPlaneStatusText } from "../../deployments/deployment-control-plane-status-format";

test("control-plane submit and status responses preserve public service-instance diagnostics", () => {
  const submission = {
    submissionId: "submission-1",
    submittedAt: "2026-04-25T12:00:00.000Z",
    deploymentId: "demoapp-dev",
    deploymentLabel: "//projects/deployments/demoapp-dev:deploy",
    operationKind: "deploy",
    providerTargetIdentity: "nixos-shared-host:shared-nonprod:demoapp-dev",
    lockScope: "nixos-shared-host:shared-nonprod:demoapp-dev",
    lifecycleState: "finished" as const,
    terminationReason: "no_longer_admitted" as const,
    dedupe: { mode: "created" as const, requestFingerprint: "sha256:submit" },
    serviceInstance: {
      hostname: "mini",
      workspaceRoot: "/srv/viberoots",
      gitHead: "8f00f5cd723bed179a48847d2daeea3e0c2dcce1",
      reviewedRef: "env/pleomino/dev",
      reviewedRepository: "viberoots/viberoots",
      reviewedRemoteName: "origin",
      reviewedRemoteUrl: "git@github.com:viberoots/viberoots.git",
    },
  };

  const submit = submitResponseFromSubmission(submission as any);
  const status = statusFromSubmission(submission as any);

  assert.deepEqual(submit.serviceInstance, submission.serviceInstance);
  assert.deepEqual(status.serviceInstance, submission.serviceInstance);
  assert.match(formatDeploymentControlPlaneStatusText(status), /service: git 8f00f5/);
});
