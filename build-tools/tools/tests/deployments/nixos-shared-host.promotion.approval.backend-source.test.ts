#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitDeploymentControlPlaneRunAction } from "../../deployments/deployment-control-plane-run-action";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane";
import { submitNixosSharedHostPublishOnlyRun } from "../../deployments/nixos-shared-host-publish-only";
import { runInTemp } from "../lib/test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostDeploymentFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";
import { smokeConnectOverride, writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";
import {
  seedCurrentStageState,
  seedSyntheticTargetStageState,
} from "./nixos-shared-host.promotion.stage-state.helpers";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

function promotionLanePolicy() {
  return nixosSharedHostLanePolicyFixture({
    allowedPromotionEdges: ["dev->staging"],
  });
}

function sourceDeployment() {
  const lanePolicy = promotionLanePolicy();
  return nixosSharedHostDeploymentFixture({
    deploymentId: "demoapp-dev-shared",
    label: "//projects/deployments/demoapp-dev-shared:deploy",
    lanePolicyRef: lanePolicy.ref,
    lanePolicy,
    environmentStage: "dev",
    runtime: {
      appName: "demoapp-dev",
      containerPort: 3000,
      healthPath: "/healthz",
    },
  });
}

function targetDeployment() {
  const lanePolicy = promotionLanePolicy();
  const admissionPolicy = nixosSharedHostAdmissionPolicyFixture({
    ref: "//projects/deployments/demoapp-shared:staging_release",
    name: "staging_release",
    allowedRefs: ["main"],
    requiredChecks: [],
    requiredApprovals: ["human/staging"],
    fingerprint: "sha256:admission-demoapp-staging",
  });
  return nixosSharedHostDeploymentFixture({
    deploymentId: "demoapp-staging-shared",
    label: "//projects/deployments/demoapp-staging-shared:deploy",
    lanePolicyRef: lanePolicy.ref,
    lanePolicy,
    environmentStage: "staging",
    admissionPolicyRef: admissionPolicy.ref,
    admissionPolicy,
    runtime: {
      appName: "demoapp-staging",
      containerPort: 3000,
      healthPath: "/healthz",
    },
  });
}

test("shared-host promotion approval rehydrates backend source state when the source mirror is deleted", async () => {
  await runInTemp("nixos-shared-host-promotion-approval-backend-source", async (tmp, $) => {
    const source = sourceDeployment();
    const target = targetDeployment();
    const sourceArtifactDir = path.join(tmp, "source-artifact");
    const sourceHostRoot = path.join(tmp, "source-host");
    const targetHostRoot = path.join(tmp, "target-host");
    const recordsRoot = path.join(tmp, "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    await writeDemoArtifact(sourceArtifactDir, "promoted release");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, source);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, target);
    const sourceServer = await startNixosSharedHostPublicServer({
      deployment: source,
      hostRoot: sourceHostRoot,
    });
    const targetServer = await startNixosSharedHostPublicServer({
      deployment: target,
      hostRoot: targetHostRoot,
    });
    try {
      const sourceRun = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment: source,
        artifactDir: sourceArtifactDir,
        paths: {
          statePath: path.join(tmp, "source-platform-state.json"),
          hostRoot: sourceHostRoot,
          recordsRoot,
        },
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment: source }),
        smokeConnectOverride: smokeConnectOverride(sourceServer.port),
      });
      await seedCurrentStageState({
        recordsRoot,
        recordPath: sourceRun.recordPath,
        deployment: source,
      });
      await seedSyntheticTargetStageState({ recordsRoot, deployment: target });
      await fsp.rm(sourceRun.recordPath, { force: true });

      let pending: any;
      try {
        await submitNixosSharedHostPublishOnlyRun({
          workspaceRoot: tmp,
          deployment: target,
          sourceRunId: sourceRun.record.deployRunId,
          rollback: false,
          backendDatabaseUrl,
          paths: {
            statePath: path.join(tmp, "target-platform-state.json"),
            hostRoot: targetHostRoot,
            recordsRoot,
          },
          admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment: target }),
          smokeConnectOverride: smokeConnectOverride(targetServer.port),
        });
        assert.fail("expected pending approval promotion");
      } catch (error: any) {
        pending = error;
      }

      assert.equal(pending.submission.lifecycleState, "pending_approval");
      assert.equal(await fsp.stat(sourceRun.recordPath).catch(() => null), null);
      const snapshot = JSON.parse(
        await fsp.readFile(String(pending.executionSnapshotPath), "utf8"),
      ) as { action: Record<string, unknown> };
      assert.equal("sourceRecordPath" in snapshot.action, false);

      const approved = await submitDeploymentControlPlaneRunAction({
        workspaceRoot: tmp,
        recordsRoot,
        backendDatabaseUrl,
        submissionPath: String(pending.submissionPath),
        action: "approve",
        idempotencyKey: "approve-shared-promotion-backend-source",
        requestedBy: { principalId: "user:reviewer" },
        approval: {
          approvalId: "ticket-shared-promotion",
          expectedPayloadFingerprint: pending.submission.approval.payloadFingerprint,
          expectedProvisionerPlanFingerprint:
            pending.submission.approval.provisionerPlanFingerprint,
        },
      });

      assert.equal(approved.lifecycleState, "waiting_for_lock");
      assert.equal(approved.approval?.state, "granted");
      assert.equal(approved.deployRunId, pending.submission.deployRunId);
    } finally {
      await sourceServer.close();
      await targetServer.close();
    }
  });
});
