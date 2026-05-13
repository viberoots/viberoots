#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  localHarnessControlPlaneDatabaseUrl,
  readBackendCurrentStageState,
  writeBackendDeployRecordDoc,
  writeBackendSnapshotDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { createKubernetesDeployRecord } from "../../deployments/kubernetes-records";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture";

test("current-stage state retains Kubernetes component artifact provenance", async () => {
  const recordsRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-stage-state-k8s-"));
  const backend = { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
  const deployment = kubernetesDeploymentFixture();
  const submissionId = "cp-k8s-stage";
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
  const record = createKubernetesDeployRecord(deployment, {
    deployRunId: "deploy-k8s-1",
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
      {
        componentId: "api",
        identity: "image-digest:sha256:0123",
        storedArtifactPath,
        provenancePath,
      },
    ],
    admittedContext: { source: { sourceRevision: "rev-k8s-1" } },
    deploymentMetadataFingerprint: "sha256:deployment",
  } as any);
  await writeBackendDeployRecordDoc(
    backend,
    record,
    path.join(recordsRoot, "runs", `${record.deployRunId}.json`),
  );
  const state = await readBackendCurrentStageState(backend, {
    deploymentId: deployment.deploymentId,
    environmentStage: deployment.environmentStage,
  });
  assert.deepEqual(state?.retainedArtifactEvidence, [
    { identity: "image-digest:sha256:0123", storedArtifactPath, provenancePath },
  ]);
});
