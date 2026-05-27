#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  assertMiniCloudMigrationPreflight,
  validateMiniCloudMigrationEvidence,
} from "../../deployments/control-plane-mini-migration-preflight";
import { handleControlPlaneSubmit } from "../../deployments/nixos-shared-host-control-plane-service-api";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract";
import {
  enqueueBackendSubmission,
  localHarnessControlPlaneDatabaseUrl,
  writeBackendSubmissionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import { runInTemp } from "../lib/test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { writeDemoArtifact, readJson } from "./nixos-shared-host.control-plane.helpers";
import {
  challengedSubmitProof,
  challengedSubmitRequest,
  memoryArtifactStore,
} from "./nixos-shared-host.challenged-submit.helpers";

const passedEvidence = {
  stateSync: { status: "passed" as const, checkedAt: "2026-05-26T10:00:00.000Z" },
  restore: {
    status: "passed" as const,
    checkedAt: "2026-05-26T10:05:00.000Z",
    evidenceRef: "s3://mini-migration/restore.json",
  },
  rollback: {
    status: "passed" as const,
    checkedAt: "2026-05-26T10:10:00.000Z",
    evidenceRef: "s3://mini-migration/rollback.json",
  },
  migratedRows: {
    submissions: 1,
    queue: 1,
    control_plane_audit_events: 1,
    current_stage_state: 1,
    deploy_records: 1,
    idempotency: 1,
  },
};

const emptyPassedEvidence = {
  ...passedEvidence,
  migratedRows: {
    submissions: 0,
    queue: 0,
    control_plane_audit_events: 0,
    current_stage_state: 0,
    deploy_records: 0,
    idempotency: 0,
  },
};

test("mini migration preflight requires sync, restore, rollback, and durable row evidence", async () => {
  await runInTemp("control-plane-mini-migration-preflight", async (tmp) => {
    const backend = { recordsRoot: tmp, databaseUrl: localHarnessControlPlaneDatabaseUrl(tmp) };
    await writeBackendSubmissionDoc(
      backend,
      {
        submissionId: "mini-cutover",
        deploymentId: "demoapp-dev",
        executionSnapshotPath: path.join(tmp, "snapshot.json"),
        lockScope: "nixos-shared-host:mini:demoapp",
        lifecycleState: "queued",
      },
      { submissionPath: path.join(tmp, "submission.json"), executionSnapshotPath: "snapshot" },
    );
    await enqueueBackendSubmission(backend, "mini-cutover", "2026-05-26T10:00:00.000Z");
    await queryBackend(
      backend,
      `INSERT INTO current_stage_state
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      ["demoapp-dev", "dev", "run-1", JSON.stringify({ deployRunId: "run-1" }), new Date()],
    );
    await queryBackend(backend, `INSERT INTO deploy_records VALUES ($1, $2, $3, $4::jsonb, $5)`, [
      "run-1",
      "mini-cutover",
      "record.json",
      JSON.stringify({ deployRunId: "run-1" }),
      new Date(),
    ]);
    await queryBackend(backend, `INSERT INTO idempotency VALUES ($1, $2, $3, $4)`, [
      "submit",
      "hash",
      "fingerprint",
      "mini-cutover",
    ]);
    await assertMiniCloudMigrationPreflight({ enabled: true, backend, evidence: passedEvidence });
  });
});

test("mini migration preflight fails closed for missing or stale evidence", async () => {
  assert.throws(() => validateMiniCloudMigrationEvidence(undefined), /evidence is required/);
  assert.throws(
    () =>
      validateMiniCloudMigrationEvidence({
        ...passedEvidence,
        rollback: { ...passedEvidence.rollback, status: "failed" as any },
      }),
    /rollback.status/,
  );
  await runInTemp("control-plane-mini-migration-preflight-fail", async (tmp) => {
    const backend = { recordsRoot: tmp, databaseUrl: localHarnessControlPlaneDatabaseUrl(tmp) };
    await assert.rejects(
      assertMiniCloudMigrationPreflight({ enabled: true, backend, evidence: passedEvidence }),
      /mini cloud migration preflight failed for submissions/,
    );
  });
});

test("normal protected/shared submit refuses mini cutover without migration evidence", async () => {
  await runInTemp("control-plane-mini-migration-normal-submit", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const paths = {
      statePath: path.join(tmp, "state.json"),
      hostRoot: tmp,
      recordsRoot: path.join(tmp, "records"),
    };
    const backend = {
      recordsRoot: paths.recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    };
    const artifactDir = path.join(tmp, "artifact");
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const admissionEvidence = reviewedLaneAdmissionEvidenceFixture({ deployment }) as any;
    delete admissionEvidence.requestedBy;
    const request = {
      schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
      submissionId: "mini-normal-submit",
      submittedAt: "2026-05-26T11:00:00.000Z",
      deployment,
      operationKind: "deploy" as const,
      idempotencyKey: "mini-normal-submit",
      artifactDir,
      admissionEvidence,
    };
    await assert.rejects(
      handleControlPlaneSubmit(request, {
        workspaceRoot: tmp,
        paths,
        backend,
        localFixture: true,
        miniMigrationPreflight: { enabled: true },
      }),
      /mini cloud migration evidence is required/,
    );
    const accepted = await handleControlPlaneSubmit(
      { ...request, miniMigrationEvidence: emptyPassedEvidence },
      {
        workspaceRoot: tmp,
        paths,
        backend,
        localFixture: true,
        miniMigrationPreflight: { enabled: true },
      },
    );
    assert.equal(accepted.lifecycleState, "waiting_for_lock");
  });
});

test("challenged protected submit refuses mini cutover without migration evidence", async () => {
  await runInTemp("control-plane-mini-migration-challenged-submit", async (tmp, $) => {
    const artifactDir = path.join(tmp, "artifact");
    await writeDemoArtifact(artifactDir);
    const request = await challengedSubmitRequest(artifactDir, "mini-challenged-submit");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, request.deployment);
    const paths = {
      statePath: path.join(tmp, "state.json"),
      hostRoot: tmp,
      recordsRoot: path.join(tmp, "records"),
    };
    const backend = {
      recordsRoot: paths.recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    };
    const token = "mini-migration-token";
    const service = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: backend.databaseUrl,
      token,
      objectStore: memoryArtifactStore(),
      miniMigrationPreflight: { enabled: true },
    });
    try {
      const challenge = await readJson<any>(
        await fetch(new URL("/api/v1/submission-challenges/artifact", service.url), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(request),
        }),
      );
      const body = {
        ...request,
        artifactBindingProof: challengedSubmitProof(request, challenge, token),
      };
      const rejected = await fetch(new URL("/api/v1/submissions", service.url), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      assert.equal(rejected.ok, false);
      assert.match(await rejected.text(), /mini cloud migration evidence is required/);
      const accepted = await readJson<any>(
        await fetch(new URL("/api/v1/submissions", service.url), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...body, miniMigrationEvidence: emptyPassedEvidence }),
        }),
      );
      assert.equal(accepted.lifecycleState, "waiting_for_lock");
    } finally {
      await service.close();
    }
  });
});
