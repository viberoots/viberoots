#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";
import {
  replayDeploymentFixture,
  replayPaths,
  replaySmokeConnect,
  resolveReplaySelection,
  writeReplayArtifact,
} from "./nixos-shared-host.replay.rollback-eligibility.helpers.ts";

test("rollback rejects a successful retry source while retry reuse stays available", async () => {
  await runInTemp("nixos-shared-host-replay-retry-source", async (tmp, $) => {
    const deployment = replayDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const paths = replayPaths(tmp);
    await writeReplayArtifact(artifactDir, "retry-source");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
    try {
      const initial = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths,
        smokeConnectOverride: replaySmokeConnect(server.port),
      });
      const retrySource = await resolveReplaySelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        sourceRunId: initial.record.deployRunId,
        rollback: false,
      });
      const retry = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: retrySource.operationKind,
        deployment: retrySource.deployment,
        ...(retrySource.artifact ? { artifact: retrySource.artifact } : {}),
        ...(retrySource.componentArtifacts
          ? { componentArtifacts: retrySource.componentArtifacts }
          : {}),
        publishBehavior: "publish-only",
        parentRunId: retrySource.parentRunId,
        artifactLineageId: retrySource.artifactLineageId,
        ...(retrySource.releaseLineageId ? { releaseLineageId: retrySource.releaseLineageId } : {}),
        source: {
          record: retrySource.sourceRecord,
          replaySnapshot: retrySource.sourceReplaySnapshot,
        },
        paths,
        smokeConnectOverride: replaySmokeConnect(server.port),
      });
      const retrySelection = await resolveReplaySelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        sourceRunId: retry.record.deployRunId,
        rollback: false,
      });
      assert.equal(retrySelection.operationKind, "retry");
      assert.equal(retrySelection.parentRunId, retry.record.deployRunId);
      await assert.rejects(
        resolveReplaySelection({
          deployment,
          recordsRoot: paths.recordsRoot,
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
    await writeReplayArtifact(artifactDir, "rollback-source");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: paths.hostRoot,
    });
    try {
      const initial = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths,
        smokeConnectOverride: replaySmokeConnect(server.port),
      });
      const rollbackSource = await resolveReplaySelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        sourceRunId: initial.record.deployRunId,
        rollback: true,
      });
      const rollback = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: rollbackSource.operationKind,
        deployment: rollbackSource.deployment,
        ...(rollbackSource.artifact ? { artifact: rollbackSource.artifact } : {}),
        ...(rollbackSource.componentArtifacts
          ? { componentArtifacts: rollbackSource.componentArtifacts }
          : {}),
        publishBehavior: "publish-only",
        parentRunId: rollbackSource.parentRunId,
        artifactLineageId: rollbackSource.artifactLineageId,
        ...(rollbackSource.releaseLineageId
          ? { releaseLineageId: rollbackSource.releaseLineageId }
          : {}),
        source: {
          record: rollbackSource.sourceRecord,
          replaySnapshot: rollbackSource.sourceReplaySnapshot,
        },
        paths,
        smokeConnectOverride: replaySmokeConnect(server.port),
      });
      const retrySelection = await resolveReplaySelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        sourceRunId: rollback.record.deployRunId,
        rollback: false,
      });
      assert.equal(retrySelection.operationKind, "retry");
      await assert.rejects(
        resolveReplaySelection({
          deployment,
          recordsRoot: paths.recordsRoot,
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
    await writeReplayArtifact(artifactDir, "explicit-removal");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
    try {
      await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths,
        smokeConnectOverride: replaySmokeConnect(server.port),
      });
      const removal = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "explicit_removal",
        deployment,
        paths,
      });
      await assert.rejects(
        resolveReplaySelection({
          deployment,
          recordsRoot: paths.recordsRoot,
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
    await writeReplayArtifact(artifactDir, "failed-source", false);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
    try {
      const failedRunId = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths,
        smokeConnectOverride: replaySmokeConnect(server.port),
      }).then(
        () => assert.fail("expected deploy failure"),
        (error: any) => {
          assert.equal(error.record.finalOutcome, "smoke_failed_after_publish");
          return String(error.record.deployRunId);
        },
      );
      const retrySelection = await resolveReplaySelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        sourceRunId: failedRunId,
        rollback: false,
      });
      assert.equal(retrySelection.operationKind, "retry");
      await assert.rejects(
        resolveReplaySelection({
          deployment,
          recordsRoot: paths.recordsRoot,
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
