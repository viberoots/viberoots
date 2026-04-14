#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { createNixosSharedHostDeployRecord } from "../../deployments/nixos-shared-host-records.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

test("nixos-shared-host durable records persist canonical provider-target identity and artifact identity", () => {
  const deployment = nixosSharedHostDeploymentFixture({
    runtime: { appName: "demoapp", containerPort: 3000, targetGroup: "shared-dev" },
  });
  const record = createNixosSharedHostDeployRecord(deployment, {
    deployRunId: "deploy-123",
    runClassification: "deploy",
    finalOutcome: "succeeded",
    artifactIdentity: "static-webapp:abc123",
    artifactStoredArtifactPath: "/tmp/records/artifacts/blobs/static-webapp-abc123",
    artifactProvenancePath: "/tmp/records/artifacts/provenance/static-webapp-abc123.json",
    artifactLineageId: "static-webapp:abc123",
    deployBatchId: "batch-123",
    admittedContext: {
      lanePolicyRef: "//test-workspace/deployments/pleomino-shared:lane",
      lanePolicyFingerprint: "sha256:lane-pleomino",
      admissionPolicyRef: "//test-workspace/deployments/pleomino-shared:dev_release",
      admissionPolicyFingerprint: "sha256:admission-pleomino-dev",
      environmentStage: "dev",
      source: {
        mode: "stage_branch_head",
        sourceRef: "env/pleomino/dev",
        sourceRevision: "abc123",
        artifactIdentity: "static-webapp:abc123",
        artifactTrustMode: "recorded_exact_artifact",
      },
      targetEnvironment: {
        mode: "stage_branch_snapshot",
        targetRef: "env/pleomino/dev",
        targetRevision: "abc123",
        providerTargetIdentity: "nixos-shared-host:shared-dev:demoapp",
        lockScope: "nixos-shared-host:shared-dev:demoapp",
      },
    },
    deploymentMetadataFingerprint: "sha256:deadbeef",
    replaySnapshotPath: "/tmp/records/replay/deploy-123/snapshot.json",
    publicUrl: "https://demoapp.apps.kilty.io/",
    authority: {
      kind: "control-plane-worker",
      submissionId: "cp-123",
      submissionPath: "/tmp/control-plane/submissions/cp-123.json",
      workerId: "cp-123-worker",
      lockScope: "nixos-shared-host:shared-dev:demoapp",
      executionSnapshotPath: "/tmp/control-plane/snapshots/cp-123.json",
    },
    provisionerPlan: {
      artifactPath: "/tmp/control-plane/provisioner-plans/cp-123.json",
      fingerprint: "sha256:plan-123",
      mutationClass: "non_destructive",
      destructiveReasons: [],
    },
  });
  assert.equal(record.schemaVersion, "deploy-record@2026-04-10");
  assert.equal(record.operationKind, "deploy");
  assert.equal(record.publishMode, "normal");
  assert.equal(record.lifecycleState, "finished");
  assert.equal(record.terminationReason, null);
  assert.equal(record.provider, "nixos-shared-host");
  assert.equal(record.providerTargetIdentity, "nixos-shared-host:shared-dev:demoapp");
  assert.deepEqual(record.providerTarget, record.effectiveRunTarget);
  assert.deepEqual(record.controlPlane, {
    submissionId: "cp-123",
    submissionPath: "/tmp/control-plane/submissions/cp-123.json",
    workerId: "cp-123-worker",
    admission: "admitted",
    lockScope: "nixos-shared-host:shared-dev:demoapp",
    executionSnapshotPath: "/tmp/control-plane/snapshots/cp-123.json",
  });
  assert.equal(record.artifact?.identity, "static-webapp:abc123");
  assert.equal(
    record.artifact?.storedArtifactPath,
    "/tmp/records/artifacts/blobs/static-webapp-abc123",
  );
  assert.equal(
    record.artifact?.provenancePath,
    "/tmp/records/artifacts/provenance/static-webapp-abc123.json",
  );
  assert.equal(record.artifactLineageId, "static-webapp:abc123");
  assert.equal(record.deployBatchId, "batch-123");
  assert.equal(record.admittedContext?.environmentStage, "dev");
  assert.equal(record.deploymentMetadataFingerprint, "sha256:deadbeef");
  assert.equal(record.replaySnapshotPath, "/tmp/records/replay/deploy-123/snapshot.json");
  assert.equal(record.publisherType, "nixos-shared-host-static-webapp");
  assert.equal(record.smokeRunnerType, "nixos-shared-host-static-webapp-smoke");
  assert.deepEqual(record.runnerIdentities, {
    publisher: "nixos-shared-host-static-webapp",
    provisioner: "nixos-shared-host-manifest",
    smoke: "nixos-shared-host-static-webapp-smoke",
  });
  assert.equal(
    record.provisionerPlan?.artifactPath,
    "/tmp/control-plane/provisioner-plans/cp-123.json",
  );
  assert.equal(record.provisionerPlan?.fingerprint, "sha256:plan-123");
});

test("nixos-shared-host retry records preserve parent-run and artifact-lineage fields", () => {
  const record = createNixosSharedHostDeployRecord(nixosSharedHostDeploymentFixture(), {
    deployRunId: "deploy-456",
    operationKind: "retry",
    runClassification: "retry",
    finalOutcome: "succeeded",
    parentRunId: "deploy-123",
    artifactIdentity: "static-webapp:abc123",
    artifactLineageId: "static-webapp:abc123",
  });
  assert.equal(record.operationKind, "retry");
  assert.equal(record.runClassification, "retry");
  assert.equal(record.parentRunId, "deploy-123");
  assert.equal(record.artifactLineageId, "static-webapp:abc123");
  assert.equal(record.publisherType, "nixos-shared-host-static-webapp");
});

test("nixos-shared-host promotion records preserve release and artifact lineage", () => {
  const record = createNixosSharedHostDeployRecord(nixosSharedHostDeploymentFixture(), {
    deployRunId: "deploy-789",
    operationKind: "promotion",
    runClassification: "promotion",
    finalOutcome: "succeeded",
    parentRunId: "deploy-456",
    releaseLineageId: "release-123",
    artifactIdentity: "static-webapp:def456",
    artifactLineageId: "static-webapp:def456",
  });
  assert.equal(record.operationKind, "promotion");
  assert.equal(record.runClassification, "promotion");
  assert.equal(record.parentRunId, "deploy-456");
  assert.equal(record.releaseLineageId, "release-123");
  assert.equal(record.artifactLineageId, "static-webapp:def456");
});
