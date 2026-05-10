#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  localHarnessControlPlaneDatabaseUrl,
  syncBackendDeployRecord,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane";
import { createNixosSharedHostPlatformState } from "../../deployments/nixos-shared-host-platform";
import { resolveNixosSharedHostReplaySelection } from "../../deployments/nixos-shared-host-replay";
import { runInTemp } from "../lib/test-helpers";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import {
  assertFrozenSnapshotExecution,
  smokeConnectOverride,
  withEnvOverrides,
  writeDemoArtifact,
} from "./nixos-shared-host.control-plane.helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

test("shared control plane admits shared_nonprod deploys and executes from the frozen snapshot", async () => {
  await runInTemp("nixos-shared-host-control-plane-admit", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      const result = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths: {
          statePath: path.join(tmp, "platform-state.json"),
          hostRoot,
          recordsRoot: path.join(tmp, "records"),
        },
        smokeConnectOverride: smokeConnectOverride(server.port),
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
        hooks: {
          afterSnapshotWritten: async () => {
            deployment.deploymentId = "tampered";
            deployment.label = "//projects/deployments/tampered:deploy";
            deployment.providerTarget.sharedDevTargetIdentity = "tampered-target";
            await fsp.rm(artifactDir, { recursive: true, force: true });
          },
        },
      });
      assert.equal(result.submission.admission.decision, "admitted");
      assert.equal(result.lockScope, "nixos-shared-host:default:demoapp");
      assert.equal(deployment.providerTarget.sharedDevTargetIdentity, "tampered-target");
      await assertFrozenSnapshotExecution(result);
    } finally {
      await server.close();
    }
  });
});

test("shared control plane rejects routine deploys whose provisioner plan would replace a live target identity", async () => {
  await runInTemp("nixos-shared-host-control-plane-destructive-plan", async (tmp, $) => {
    const existing = nixosSharedHostDeploymentFixture({
      runtime: { appName: "oldapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const artifactDir = path.join(tmp, "artifact");
    const statePath = path.join(tmp, "platform-state.json");
    await writeDemoArtifact(artifactDir);
    await fsp.writeFile(
      statePath,
      JSON.stringify(createNixosSharedHostPlatformState([existing]), null, 2) + "\n",
      "utf8",
    );
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await assert.rejects(
      submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths: {
          statePath,
          hostRoot: path.join(tmp, "host"),
          recordsRoot: path.join(tmp, "records"),
        },
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
      }),
      (error: any) => {
        assert.equal(error.submission.admission.decision, "rejected");
        assert.equal(error.submission.rejectionCode, "no_longer_admitted");
        assert.match(error.message, /destructive provisioner plan/);
        return true;
      },
    );
  });
});

test("shared control plane rejects replay when the current lane policy no longer matches the source run", async () => {
  await runInTemp("nixos-shared-host-control-plane-lane-drift", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(paths.recordsRoot);
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
    try {
      const initial = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths,
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
        smokeConnectOverride: smokeConnectOverride(server.port),
      });
      await syncBackendDeployRecord(
        { recordsRoot: paths.recordsRoot, databaseUrl: backendDatabaseUrl },
        initial.recordPath,
      );
      const replay = await resolveNixosSharedHostReplaySelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        backendDatabaseUrl,
        sourceRunId: initial.record.deployRunId,
        rollback: false,
      });
      const driftedDeployment = nixosSharedHostDeploymentFixture({
        lanePolicy: {
          ...deployment.lanePolicy,
          fingerprint: "sha256:lane-pleomino-drifted",
        },
      });
      await assert.rejects(
        submitNixosSharedHostControlPlaneRun({
          workspaceRoot: tmp,
          operationKind: replay.operationKind,
          deployment: driftedDeployment,
          ...(replay.artifact ? { artifact: replay.artifact } : {}),
          ...(replay.componentArtifacts ? { componentArtifacts: replay.componentArtifacts } : {}),
          publishBehavior: "publish-only",
          parentRunId: replay.parentRunId,
          artifactLineageId: replay.artifactLineageId,
          source: {
            record: replay.sourceRecord,
            replaySnapshot: replay.sourceReplaySnapshot,
          },
          paths,
          admissionEvidence: reviewedLaneAdmissionEvidenceFixture({
            deployment: driftedDeployment,
          }),
          smokeConnectOverride: smokeConnectOverride(server.port),
        }),
        /source run is outside current lane policy/,
      );
    } finally {
      await server.close();
    }
  });
});

test("shared control plane times out queued runs when another holder keeps the shared lock", async () => {
  await withEnvOverrides(
    {
      VBR_DEPLOY_LOCK_WAIT_TIMEOUT_MS: "200",
      VBR_DEPLOY_LOCK_POLL_MS: "25",
    },
    async () => {
      await runInTemp("nixos-shared-host-control-plane-lock-conflict", async (tmp) => {
        const deployment = nixosSharedHostDeploymentFixture();
        let releaseLock!: () => void;
        const holdLock = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        let lockAcquired!: () => void;
        const firstHasLock = new Promise<void>((resolve) => {
          lockAcquired = resolve;
        });
        const firstRun = submitNixosSharedHostControlPlaneRun({
          workspaceRoot: tmp,
          operationKind: "explicit_removal",
          deployment,
          paths: {
            statePath: path.join(tmp, "platform-state.json"),
            hostRoot: path.join(tmp, "host"),
            recordsRoot: path.join(tmp, "records"),
          },
          admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
          hooks: {
            onLockAcquired: async () => {
              lockAcquired();
              await holdLock;
            },
          },
        });
        await firstHasLock;
        await assert.rejects(
          submitNixosSharedHostControlPlaneRun({
            workspaceRoot: tmp,
            operationKind: "explicit_removal",
            deployment: nixosSharedHostDeploymentFixture(),
            paths: {
              statePath: path.join(tmp, "platform-state.json"),
              hostRoot: path.join(tmp, "host"),
              recordsRoot: path.join(tmp, "records"),
            },
            admissionEvidence: reviewedLaneAdmissionEvidenceFixture({
              deployment: nixosSharedHostDeploymentFixture(),
            }),
          }),
          (error: any) => {
            assert.equal(error.submission.admission.decision, "admitted");
            assert.equal(error.submission.terminationReason, "lock_timeout");
            assert.equal(error.submission.lifecycleState, "finished");
            assert.equal(error.submission.lockScope, "nixos-shared-host:default:demoapp");
            assert.match(error.message, /lock timeout/);
            return true;
          },
        );
        releaseLock();
        const firstResult = await firstRun;
        assert.equal(firstResult.submission.admission.decision, "admitted");
        assert.equal(firstResult.lockScope, "nixos-shared-host:default:demoapp");
      });
    },
  );
});
