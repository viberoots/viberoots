#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import { resolveNixosSharedHostReplaySelection } from "../../deployments/nixos-shared-host-replay.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

async function writeArtifact(root: string, marker: string, includeHealthz = true): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `<html>${marker}</html>\n`, "utf8");
  if (includeHealthz) {
    await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
  }
}

function smokeConnect(port: number) {
  return { protocol: "https:" as const, hostname: "127.0.0.1", port, rejectUnauthorized: false };
}

function replayPaths(tmp: string) {
  return {
    statePath: path.join(tmp, "platform-state.json"),
    hostRoot: path.join(tmp, "host"),
    recordsRoot: path.join(tmp, "records"),
  };
}

function replayDeploymentFixture() {
  return nixosSharedHostDeploymentFixture({
    runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
  });
}

const resolveSelection = (opts: {
  deployment: ReturnType<typeof nixosSharedHostDeploymentFixture>;
  recordsRoot: string;
  sourceRunId: string;
  rollback: boolean;
}) => resolveNixosSharedHostReplaySelection(opts);

test("rollback rejects a successful retry source while retry reuse stays available", async () => {
  await runInTemp("nixos-shared-host-replay-retry-source", async (tmp, $) => {
    const deployment = replayDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const paths = replayPaths(tmp);
    await writeArtifact(artifactDir, "retry-source");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
    try {
      const initial = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths,
        smokeConnectOverride: smokeConnect(server.port),
      });
      const retrySource = await resolveSelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        sourceRunId: initial.record.deployRunId,
        rollback: false,
      });
      const retry = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: retrySource.operationKind,
        deployment: retrySource.deployment,
        artifact: retrySource.artifact,
        publishBehavior: "publish-only",
        parentRunId: retrySource.parentRunId,
        artifactLineageId: retrySource.artifactLineageId,
        ...(retrySource.releaseLineageId ? { releaseLineageId: retrySource.releaseLineageId } : {}),
        source: {
          record: retrySource.sourceRecord,
          replaySnapshot: retrySource.sourceReplaySnapshot,
        },
        paths,
        smokeConnectOverride: smokeConnect(server.port),
      });
      const retrySelection = await resolveSelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        sourceRunId: retry.record.deployRunId,
        rollback: false,
      });
      assert.equal(retrySelection.operationKind, "retry");
      assert.equal(retrySelection.parentRunId, retry.record.deployRunId);
      await assert.rejects(
        resolveSelection({
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
    await writeArtifact(artifactDir, "rollback-source");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
    try {
      const initial = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths,
        smokeConnectOverride: smokeConnect(server.port),
      });
      const rollbackSource = await resolveSelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        sourceRunId: initial.record.deployRunId,
        rollback: true,
      });
      const rollback = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: rollbackSource.operationKind,
        deployment: rollbackSource.deployment,
        artifact: rollbackSource.artifact,
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
        smokeConnectOverride: smokeConnect(server.port),
      });
      const retrySelection = await resolveSelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        sourceRunId: rollback.record.deployRunId,
        rollback: false,
      });
      assert.equal(retrySelection.operationKind, "retry");
      await assert.rejects(
        resolveSelection({
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
    await writeArtifact(artifactDir, "explicit-removal");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
    try {
      await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths,
        smokeConnectOverride: smokeConnect(server.port),
      });
      const removal = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "explicit_removal",
        deployment,
        paths,
      });
      await assert.rejects(
        resolveSelection({
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
    await writeArtifact(artifactDir, "failed-source", false);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
    try {
      const failedRunId = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths,
        smokeConnectOverride: smokeConnect(server.port),
      }).then(
        () => assert.fail("expected deploy failure"),
        (error: any) => {
          assert.equal(error.record.finalOutcome, "smoke_failed_after_publish");
          return String(error.record.deployRunId);
        },
      );
      const retrySelection = await resolveSelection({
        deployment,
        recordsRoot: paths.recordsRoot,
        sourceRunId: failedRunId,
        rollback: false,
      });
      assert.equal(retrySelection.operationKind, "retry");
      await assert.rejects(
        resolveSelection({
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
