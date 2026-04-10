#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import { createNixosSharedHostPlatformState } from "../../deployments/nixos-shared-host-platform.ts";
import { resolveNixosSharedHostReplaySelection } from "../../deployments/nixos-shared-host-replay.ts";
import { runNixosSharedHostStaticDeploy } from "../../deployments/nixos-shared-host-static-deploy.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>demoapp</html>\n", "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

async function withLockEnv<T>(overrides: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("shared control plane admits shared_nonprod deploys and executes from the frozen snapshot", async () => {
  await runInTemp("nixos-shared-host-control-plane-admit", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    await writeArtifact(artifactDir);
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
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
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
      const snapshot = JSON.parse(await fsp.readFile(result.executionSnapshotPath, "utf8"));
      assert.equal(snapshot.deploymentId, "demoapp-dev");
      assert.equal(snapshot.deploymentLabel, "//projects/deployments/demoapp-dev:deploy");
      assert.equal(snapshot.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      assert.equal(snapshot.action.publishInput.kind, "exact-artifact");
      assert.equal(snapshot.provisionerPlan?.mutationClass, "non_destructive");
      assert.ok(snapshot.provisionerPlan?.artifactPath);
      assert.equal(
        snapshot.admittedContext.policyEvaluation.binding.provisionerPlanFingerprint,
        snapshot.provisionerPlan?.fingerprint,
      );
      assert.equal(snapshot.admittedContext.source.sourceRef, "env/pleomino/dev");
      assert.equal(snapshot.admittedContext.targetEnvironment.targetRef, "env/pleomino/dev");
      assert.equal(
        snapshot.admittedContext.policyEvaluation.binding.targetIdentity,
        result.lockScope,
      );
      assert.equal(
        snapshot.action.publishInput.artifact.identity,
        result.record.artifact?.identity,
      );
      assert.equal(result.record.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      assert.equal(result.record.admittedContext.source.mode, "stage_branch_head");
      assert.equal(
        result.record.provisionerPlan?.fingerprint,
        snapshot.provisionerPlan?.fingerprint,
      );
      assert.equal(
        result.record.admittedContext.policyEvaluation.binding.targetIdentity,
        result.lockScope,
      );
      assert.ok(result.record.controlPlane);
      assert.equal(result.record.controlPlane.submissionId, result.submission.submissionId);
      assert.equal(result.record.controlPlane.executionSnapshotPath, result.executionSnapshotPath);
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
    await writeArtifact(artifactDir);
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
    await writeArtifact(artifactDir);
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
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      const replay = await resolveNixosSharedHostReplaySelection({
        deployment,
        recordsRoot: paths.recordsRoot,
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
          smokeConnectOverride: {
            protocol: "https:",
            hostname: "127.0.0.1",
            port: server.port,
            rejectUnauthorized: false,
          },
        }),
        /source run is outside current lane policy/,
      );
    } finally {
      await server.close();
    }
  });
});

test("shared control plane rejects direct local shared_nonprod mutation outside the worker path", async () => {
  await runInTemp("nixos-shared-host-control-plane-direct-reject", async (tmp) => {
    await assert.rejects(
      runNixosSharedHostStaticDeploy({
        deployment: nixosSharedHostDeploymentFixture(),
        artifact: {
          kind: "nixos-shared-host-static-webapp",
          identity: "static-webapp:direct-local-reject",
          storedArtifactPath: path.join(tmp, "artifact"),
          provenancePath: path.join(tmp, "artifact.json"),
        },
        statePath: path.join(tmp, "platform-state.json"),
        hostRoot: path.join(tmp, "host"),
        recordsRoot: path.join(tmp, "records"),
      }),
      /must execute through the shared control plane/,
    );
  });
});

test("shared control plane times out queued runs when another holder keeps the shared lock", async () => {
  await withLockEnv(
    {
      BNX_DEPLOY_LOCK_WAIT_TIMEOUT_MS: "200",
      BNX_DEPLOY_LOCK_POLL_MS: "25",
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
