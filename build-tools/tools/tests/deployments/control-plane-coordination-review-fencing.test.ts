#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { commitCloudflareBackendRecord } from "../../deployments/cloudflare-pages-control-plane-backend-record-commit";
import { prepareBackendNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane-backend-prepare";
import { executeSubmittedNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane-submit-helpers";
import { createNixosSharedHostDeployRecord } from "../../deployments/nixos-shared-host-records";
import {
  localHarnessControlPlaneDatabaseUrl,
  readBackendDeployRecordByDeployRunId,
  readBackendSnapshotBySubmissionId,
  readBackendSubmissionBySubmissionId,
  writeBackendDeployRecordDoc,
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { persistMaterializedSubmission } from "../../deployments/nixos-shared-host-control-plane-backend-materialize";
import { runIfCurrentWorkerAuthority } from "../../deployments/nixos-shared-host-control-plane-worker-authority";
import { writeControlPlaneJson } from "../../deployments/nixos-shared-host-control-plane-store";
import { runInTemp } from "../lib/test-helpers";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";

function backend(recordsRoot: string) {
  return { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
}

test("cloudflare backend record commits preserve persisted fencing tokens", async () => {
  await runInTemp("control-plane-cloudflare-fencing-record", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const db = backend(recordsRoot);
    await commitCloudflareBackendRecord({
      backend: db,
      record: {
        deployRunId: "cf-run-1",
        deploymentId: "cf-pages-dev",
        provider: "cloudflare-pages",
        controlPlane: {
          submissionId: "cf-submission-1",
          workerId: "worker-a",
          lockScope: "cloudflare-pages:account/project",
          admission: "admitted",
          strippedInternal: "not-persisted",
        },
      },
      recordPath: path.join(recordsRoot, "runs", "cf-run-1.json"),
      fencingToken: "lock-token-1",
    });
    const record = (await readBackendDeployRecordByDeployRunId(db, "cf-run-1")) as any;
    assert.equal(record.controlPlane.fencingToken, "lock-token-1");
    assert.equal(record.controlPlane.strippedInternal, undefined);
  });
});

test("worker finally materialization skips durable writes after authority loss", async () => {
  await runInTemp("control-plane-worker-finally-authority-loss", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const db = backend(recordsRoot);
    const submissionId = "cp-finally-fenced";
    const executionSnapshotPath = path.join(recordsRoot, "snapshots", `${submissionId}.json`);
    const submissionRef = path.join(recordsRoot, "submissions", `${submissionId}.json`);
    const localSubmissionPath = path.join(tmp, "materialized-submission.json");
    await writeBackendSnapshotDoc(
      db,
      { submissionId, deployment: { environmentStage: "dev" } },
      executionSnapshotPath,
    );
    await writeBackendSubmissionDoc(
      db,
      {
        submissionId,
        deploymentId: "demoapp-dev",
        lockScope: "scope",
        executionSnapshotPath,
        lifecycleState: "running",
      },
      { submissionPath: submissionRef, executionSnapshotPath },
    );
    await writeControlPlaneJson(localSubmissionPath, {
      submissionId,
      deploymentId: "demoapp-dev",
      lockScope: "scope",
      executionSnapshotPath: localSubmissionPath,
      lifecycleState: "finished",
      finalOutcome: "poisoned-after-lease-loss",
    });
    const persisted = await runIfCurrentWorkerAuthority({
      assertCurrentAuthority: async () => {
        throw Object.assign(new Error("worker ownership lost"), { code: "worker_ownership_lost" });
      },
      run: async () =>
        await persistMaterializedSubmission({
          backend: db,
          submissionPath: localSubmissionPath,
          submissionRef,
          executionSnapshotRef: executionSnapshotPath,
        }),
    });
    assert.equal(persisted, false);
    const submission = (await readBackendSubmissionBySubmissionId(db, submissionId)) as any;
    assert.equal(submission.lifecycleState, "running");
    assert.equal(submission.finalOutcome, undefined);
  });
});

test("nixos shared-host records persist worker provider-lock fencing tokens", () => {
  const record = createNixosSharedHostDeployRecord(nixosSharedHostDeploymentFixture(), {
    deployRunId: "deploy-fenced",
    runClassification: "deploy",
    finalOutcome: "succeeded",
    authority: {
      kind: "control-plane-worker",
      submissionId: "cp-fenced-record",
      submissionPath: "submissions/cp-fenced-record.json",
      workerId: "worker-a",
      lockScope: "nixos-shared-host:default:demoapp",
      fencingToken: "provider-lock-token-1",
      executionSnapshotPath: "snapshots/cp-fenced-record.json",
    },
  });
  assert.equal(record.controlPlane?.fencingToken, "provider-lock-token-1");
});

test("nixos helper does not persist running status after worker authority loss", async () => {
  const deployment = nixosSharedHostDeploymentFixture();
  let persisted = false;
  await assert.rejects(
    executeSubmittedNixosSharedHostControlPlaneRun({
      submission: {
        submissionId: "cp-authority-lost",
        submittedAt: "2026-05-01T10:00:00.000Z",
        operationKind: "deploy",
        deploymentId: deployment.deploymentId,
        deploymentLabel: deployment.label,
        providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
        lockScope: deployment.providerTarget.providerTargetIdentity,
        executionSnapshotPath: "snapshot",
        lifecycleState: "waiting_for_lock",
        terminationReason: null,
        dedupe: { mode: "created", requestFingerprint: "sha256:submit" },
        admission: { decision: "admitted", reason: "shared_nonprod" },
      },
      submissionPath: "submission",
      executionSnapshotPath: "snapshot",
      snapshot: {
        submissionId: "cp-authority-lost",
        operationKind: "deploy",
        deployment,
      } as any,
      workspaceRoot: process.cwd(),
      deployRunId: "deploy-authority-lost",
      recordsRoot: process.cwd(),
      operationKind: "deploy",
      deployment,
      persistSubmission: async () => {
        persisted = true;
      },
      assertCurrentAuthority: async () => {
        throw Object.assign(new Error("worker ownership lost"), { code: "worker_ownership_lost" });
      },
      acquireLocks: async () => ({
        fencingToken: "provider-lock-token-1",
        assertCurrentAuthority: async () => {},
        release: async () => {},
      }),
    }),
    /worker ownership lost/,
  );
  assert.equal(persisted, false);
});

test("backend nixos prepare persists reviewed expected current run id", async () => {
  await runInTemp("control-plane-backend-nixos-expected-current", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const recordsRoot = path.join(tmp, "records");
    const db = backend(recordsRoot);
    const artifactDir = path.join(tmp, "artifact");
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    await writeBackendSnapshotDoc(
      db,
      {
        submissionId: "cp-current",
        deployment: { environmentStage: "dev", lanePolicy: { artifactReuseMode: "exact" } },
      },
      path.join(recordsRoot, "snapshots", "cp-current.json"),
    );
    await writeBackendDeployRecordDoc(
      db,
      {
        deployRunId: "deploy-current",
        deploymentId: deployment.deploymentId,
        operationKind: "deploy",
        publishMode: "normal",
        finalOutcome: "succeeded",
        artifactIdentity: "static-webapp:current",
        admittedContext: { source: { sourceRevision: "abc123" } },
        controlPlane: { submissionId: "cp-current" },
      } as any,
      "current.json",
      { expectedCurrentRunId: null },
    );
    const prepared = await prepareBackendNixosSharedHostControlPlaneRun({
      workspaceRoot: tmp,
      operationKind: "deploy",
      deployment,
      paths: {
        recordsRoot,
        statePath: path.join(tmp, "state.json"),
        hostRoot: path.join(tmp, "host"),
      },
      backend: db,
      submissionId: "cp-reviewed-expected",
      dedupe: { mode: "created", requestFingerprint: "sha256:expected-current" },
      artifactDir,
      admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
    });
    const persisted = (await readBackendSnapshotBySubmissionId(db, prepared.snapshot.submissionId))
      ?.snapshot as any;
    assert.equal(prepared.snapshot.expectedCurrentRunId, "deploy-current");
    assert.equal(persisted?.expectedCurrentRunId, "deploy-current");
  });
});
