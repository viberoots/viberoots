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
  });
  assert.equal(record.schemaVersion, "deploy-record@2026-04-04");
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
  assert.equal(record.deploymentMetadataFingerprint, "sha256:deadbeef");
  assert.equal(record.replaySnapshotPath, "/tmp/records/replay/deploy-123/snapshot.json");
  assert.equal(record.publisherType, "nixos-shared-host-static-webapp");
  assert.equal(record.smokeRunnerType, "nixos-shared-host-static-webapp-smoke");
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
