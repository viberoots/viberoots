#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane";
import { runInTemp } from "../lib/test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";
import {
  replayDeploymentFixture,
  replayPaths,
  replaySmokeConnect,
  resolveReplaySelection,
  submitReplaySelectionRun,
  submitReplaySourceRun,
  syncReplayRunId,
  writeReplayArtifact,
} from "./nixos-shared-host.replay.rollback-eligibility.helpers";

test("rollback rejects a successful retry source while retry reuse stays available", async () => {
  await runInTemp("nixos-shared-host-replay-retry-source", async (tmp, $) => {
    const deployment = replayDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const paths = replayPaths(tmp);
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(paths.recordsRoot);
    await writeReplayArtifact(artifactDir, "retry-source");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
    try {
      const initial = await submitReplaySourceRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths,
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
        smokeConnectOverride: replaySmokeConnect(server.port),
        backendDatabaseUrl,
      });
      const retrySource = await resolveReplaySelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        backendDatabaseUrl,
        sourceRunId: initial.record.deployRunId,
        rollback: false,
      });
      const retry = await submitReplaySelectionRun({
        workspaceRoot: tmp,
        selection: retrySource,
        paths,
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({
          deployment: retrySource.deployment,
        }),
        smokeConnectOverride: replaySmokeConnect(server.port),
        backendDatabaseUrl,
      });
      const retrySelection = await resolveReplaySelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        backendDatabaseUrl,
        sourceRunId: retry.record.deployRunId,
        rollback: false,
      });
      assert.equal(retrySelection.operationKind, "retry");
      assert.equal(retrySelection.parentRunId, retry.record.deployRunId);
      await assert.rejects(
        resolveReplaySelection({
          deployment,
          recordsRoot: paths.recordsRoot,
          backendDatabaseUrl,
          sourceRunId: retry.record.deployRunId,
          rollback: true,
        }),
        /wrong run classification: retry/,
      );
    } finally {
      await server.close();
    }
  });
});

test("rollback rejects a successful rollback source while retry reuse stays available", async () => {
  await runInTemp("nixos-shared-host-replay-rollback-source", async (tmp, $) => {
    const deployment = replayDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const paths = replayPaths(tmp);
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(paths.recordsRoot);
    await writeReplayArtifact(artifactDir, "rollback-source");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: paths.hostRoot,
    });
    try {
      const initial = await submitReplaySourceRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths,
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
        smokeConnectOverride: replaySmokeConnect(server.port),
        backendDatabaseUrl,
      });
      const rollbackSource = await resolveReplaySelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        backendDatabaseUrl,
        sourceRunId: initial.record.deployRunId,
        rollback: true,
      });
      const rollback = await submitReplaySelectionRun({
        workspaceRoot: tmp,
        selection: rollbackSource,
        paths,
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({
          deployment: rollbackSource.deployment,
        }),
        smokeConnectOverride: replaySmokeConnect(server.port),
        backendDatabaseUrl,
      });
      const retrySelection = await resolveReplaySelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        backendDatabaseUrl,
        sourceRunId: rollback.record.deployRunId,
        rollback: false,
      });
      assert.equal(retrySelection.operationKind, "retry");
      await assert.rejects(
        resolveReplaySelection({
          deployment,
          recordsRoot: paths.recordsRoot,
          backendDatabaseUrl,
          sourceRunId: rollback.record.deployRunId,
          rollback: true,
        }),
        /wrong run classification: rollback/,
      );
    } finally {
      await server.close();
    }
  });
});

test("rollback rejects explicit-removal source runs with actionable diagnostics", async () => {
  await runInTemp("nixos-shared-host-replay-explicit-removal", async (tmp, $) => {
    const deployment = replayDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const paths = replayPaths(tmp);
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(paths.recordsRoot);
    await writeReplayArtifact(artifactDir, "explicit-removal");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
    try {
      await submitReplaySourceRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths,
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
        smokeConnectOverride: replaySmokeConnect(server.port),
        backendDatabaseUrl,
      });
      const removal = await submitReplaySourceRun({
        workspaceRoot: tmp,
        operationKind: "explicit_removal",
        deployment,
        paths,
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
        backendDatabaseUrl,
      });
      await assert.rejects(
        resolveReplaySelection({
          deployment,
          recordsRoot: paths.recordsRoot,
          backendDatabaseUrl,
          sourceRunId: removal.record.deployRunId,
          rollback: true,
        }),
        /wrong run classification: explicit_removal/,
      );
    } finally {
      await server.close();
    }
  });
});

test("rollback rejects non-successful runs while retry reuse stays available", async () => {
  await runInTemp("nixos-shared-host-replay-failed-source", async (tmp, $) => {
    const deployment = replayDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const paths = replayPaths(tmp);
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(paths.recordsRoot);
    await writeReplayArtifact(artifactDir, "failed-source", false);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
    try {
      const failedRunId = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths,
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
        smokeConnectOverride: replaySmokeConnect(server.port),
      }).then(
        () => assert.fail("expected deploy failure"),
        (error: any) => {
          assert.equal(error.record.finalOutcome, "smoke_failed_after_publish");
          return String(error.record.deployRunId);
        },
      );
      await syncReplayRunId(paths, backendDatabaseUrl, failedRunId);
      const retrySelection = await resolveReplaySelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        backendDatabaseUrl,
        sourceRunId: failedRunId,
        rollback: false,
      });
      assert.equal(retrySelection.operationKind, "retry");
      await assert.rejects(
        resolveReplaySelection({
          deployment,
          recordsRoot: paths.recordsRoot,
          backendDatabaseUrl,
          sourceRunId: failedRunId,
          rollback: true,
        }),
        /non-success final outcome: smoke_failed_after_publish/,
      );
    } finally {
      await server.close();
    }
  });
});
