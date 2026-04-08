#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import {
  NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_SCHEMA,
  resolveNixosSharedHostReplaySource,
} from "../../deployments/nixos-shared-host-replay.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>demoapp</html>\n", "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

test("nixos-shared-host replay snapshots preserve exact artifact refs and admitted deployment inputs", async () => {
  await runInTemp("nixos-shared-host-replay-contract", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
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
          recordsRoot,
        },
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      const replay = await resolveNixosSharedHostReplaySource({ recordPath: result.recordPath });
      assert.equal(replay.replaySnapshot.schemaVersion, NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_SCHEMA);
      assert.equal(
        replay.replaySnapshot.providerTargetIdentity,
        result.record.providerTargetIdentity,
      );
      assert.equal(replay.replaySnapshot.publishInput.kind, "component-artifacts");
      assert.equal(replay.replaySnapshot.publishInput.components.length, 1);
      assert.equal(
        replay.replaySnapshot.publishInput.components[0]?.artifact.identity,
        result.record.artifact?.identity,
      );
      assert.equal(
        replay.replaySnapshot.deploymentMetadataFingerprint,
        result.record.deploymentMetadataFingerprint,
      );
      assert.equal(
        replay.replaySnapshot.controlPlaneExecutionSnapshotPath,
        result.executionSnapshotPath,
      );
      assert.equal(replay.replaySnapshot.admittedContext.environmentStage, "dev");
      assert.equal(
        replay.replaySnapshot.admittedContext.targetEnvironment.targetRef,
        "env/pleomino/dev",
      );
      assert.equal(
        Object.values(replay.componentArtifactDirs)[0],
        result.record.artifact?.storedArtifactPath,
      );
      await fsp.access(replay.replaySnapshot.platformStateSnapshotPath);
      await fsp.access(replay.replaySnapshot.hostConfigSnapshotPath);
    } finally {
      await server.close();
    }
  });
});

test("nixos-shared-host replay resolution fails closed when the stored exact artifact is missing", async () => {
  await runInTemp("nixos-shared-host-replay-missing-artifact", async (tmp, $) => {
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
      });
      const replay = await resolveNixosSharedHostReplaySource({ recordPath: result.recordPath });
      await fsp.rm(Object.values(replay.componentArtifactDirs)[0]!, {
        recursive: true,
        force: true,
      });
      await assert.rejects(
        resolveNixosSharedHostReplaySource({ recordPath: result.recordPath }),
        /recorded exact artifact is unavailable/,
      );
    } finally {
      await server.close();
    }
  });
});
