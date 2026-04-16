#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { submitDeploymentControlPlaneRunAction } from "../../deployments/deployment-control-plane-run-action.ts";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers.ts";

export async function pendingApprovalRun(
  tmp: string,
  $: any,
  deployment: any,
  smokeOverride?: { protocol: "http:" | "https:"; hostname: string; port: number },
  admissionEvidence?: any,
) {
  const artifactDir = path.join(tmp, "artifact");
  const recordsRoot = path.join(tmp, "records");
  const paths = {
    statePath: path.join(tmp, "platform-state.json"),
    hostRoot: path.join(tmp, "host"),
    recordsRoot,
  };
  await writeDemoArtifact(artifactDir);
  await ensureNixosSharedHostStageBranch(tmp, $, deployment);
  try {
    await submitNixosSharedHostControlPlaneRun({
      workspaceRoot: tmp,
      operationKind: "deploy",
      deployment,
      artifactDir,
      paths,
      ...(smokeOverride ? { smokeConnectOverride: smokeOverride } : {}),
      ...(admissionEvidence ? { admissionEvidence } : {}),
    });
    assert.fail("expected pending-approval submission");
  } catch (error: any) {
    return {
      recordsRoot,
      submission: error.submission,
      submissionPath: String(error.submissionPath),
      executionSnapshotPath: String(error.executionSnapshotPath),
    };
  }
}

export const requiredApprovalDeployment = () =>
  nixosSharedHostDeploymentFixture({
    admissionPolicy: {
      ...nixosSharedHostDeploymentFixture().admissionPolicy,
      requiredApprovals: ["human/dev"],
    },
  });

export async function approvePendingRun(opts: {
  workspaceRoot: string;
  pending: Awaited<ReturnType<typeof pendingApprovalRun>>;
  idempotencyKey: string;
  requestedBy: { principalId: string };
  approval: Record<string, unknown>;
}) {
  return await submitDeploymentControlPlaneRunAction({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.pending.recordsRoot,
    submissionPath: opts.pending.submissionPath,
    action: "approve",
    idempotencyKey: opts.idempotencyKey,
    requestedBy: opts.requestedBy,
    approval: opts.approval,
  });
}
