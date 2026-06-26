#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runDeploymentControlPlaneRestoreTest } from "../../deployments/deployment-control-plane-resilience";
import {
  localHarnessControlPlaneDatabaseUrl,
  writeBackendDeployRecordDoc,
  writeBackendSnapshotDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { createKubernetesDeployRecord } from "../../deployments/kubernetes-records";
import { runInTemp } from "../lib/test-helpers";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture";

test("restore validation accepts current-stage state backed by a Kubernetes record", async () => {
  await runInTemp("deployment-control-plane-restore-kubernetes", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const backend = { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
    const deployment = kubernetesDeploymentFixture();
    const submissionId = "cp-k8s-restore";
    await writeBackendSnapshotDoc(
      backend,
      {
        submissionId,
        deployment: {
          environmentStage: deployment.environmentStage,
          lanePolicy: { artifactReuseMode: "same_artifact" },
        },
      } as any,
      path.join(recordsRoot, "snapshots", `${submissionId}.json`),
    );
    const artifactRoot = path.join(recordsRoot, "artifacts");
    const storedArtifactPath = path.join(artifactRoot, "blobs", "api");
    const provenancePath = path.join(artifactRoot, "provenance", "api.json");
    const replaySnapshotPath = path.join(recordsRoot, "replay", "deploy-k8s-restore.json");
    await fsp.mkdir(storedArtifactPath, { recursive: true });
    await fsp.mkdir(path.dirname(provenancePath), { recursive: true });
    await fsp.mkdir(path.dirname(replaySnapshotPath), { recursive: true });
    await fsp.writeFile(path.join(storedArtifactPath, "marker"), "artifact\n", "utf8");
    await fsp.writeFile(provenancePath, JSON.stringify({ admittedAt: "2026-05-12T00:00:00Z" }));
    await fsp.writeFile(replaySnapshotPath, JSON.stringify({ deployRunId: "deploy-k8s-restore" }));
    const record = createKubernetesDeployRecord(deployment, {
      deployRunId: "deploy-k8s-restore",
      operationKind: "deploy",
      runClassification: "deploy",
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome: "succeeded",
      controlPlane: {
        submissionId,
        workerId: "worker-1",
        admission: "admitted",
        lockScope: deployment.providerTarget.providerTargetIdentity,
      },
      artifact: { identity: "kubernetes-composite:api" },
      componentArtifacts: [
        { componentId: "api", identity: "node-service:api", storedArtifactPath, provenancePath },
      ],
      admittedContext: { source: { sourceRevision: "rev-k8s-restore" } },
      deploymentMetadataFingerprint: "sha256:deployment",
      replaySnapshotPath,
    } as any);
    const recordPath = path.join(recordsRoot, "runs", `${record.deployRunId}.json`);
    await fsp.mkdir(path.dirname(recordPath), { recursive: true });
    await fsp.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
    await writeBackendDeployRecordDoc(backend, record, recordPath);
    const status = await runDeploymentControlPlaneRestoreTest({
      recordsRoot,
      backupRoot: path.join(tmp, "backups"),
      restoreRoot: path.join(tmp, "restore"),
      protectionClass: "shared_nonprod",
    });
    assert.equal(status.latestRestoreTest?.status, "passed", status.latestRestoreTest?.error);
    assert.equal(status.latestRestoreTest?.restoredCurrentStageStateCount, 1);
    assert.equal(status.latestRestoreTest?.retainedArtifactReferenceCount, 3);
  });
});
