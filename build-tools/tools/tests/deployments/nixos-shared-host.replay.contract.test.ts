#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import {
  NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_SCHEMA,
  resolveNixosSharedHostReplaySource,
} from "../../deployments/nixos-shared-host-replay.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { writeSsrArtifact } from "./nixos-shared-host.control-plane.helpers.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";
import {
  submitReplaySourceRun,
  writeReplayArtifact,
} from "./nixos-shared-host.replay.rollback-eligibility.helpers.ts";

test("nixos-shared-host replay snapshots preserve exact artifact refs and admitted deployment inputs", async () => {
  await runInTemp("nixos-shared-host-replay-contract", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    await writeReplayArtifact(artifactDir, "demoapp");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-replay-contract-1",
      artifactIdentity: "artifact-replay-contract-1",
      artifactLineageId: "artifact-replay-contract-1",
    });
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot,
      fixedRoot: artifactDir,
    });
    try {
      const result = await submitReplaySourceRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths: { statePath: path.join(tmp, "platform-state.json"), hostRoot, recordsRoot },
        admissionEvidence,
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
        backendDatabaseUrl,
      });
      const replay = await resolveNixosSharedHostReplaySource({
        recordsRoot,
        backendDatabaseUrl,
        deployRunId: result.record.deployRunId,
      });
      assert.equal(replay.replaySnapshot.schemaVersion, NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_SCHEMA);
      assert.equal(
        replay.replaySnapshot.providerTargetIdentity,
        result.record.providerTargetIdentity,
      );
      assert.equal(
        replay.replaySnapshot.runnerIdentities.publisher,
        result.record.runnerIdentities?.publisher,
      );
      assert.equal(replay.replaySnapshot.publishInput.kind, "component-artifacts");
      assert.equal(replay.replaySnapshot.publishInput.components.length, 1);
      assert.equal(replay.replaySnapshot.releaseActionPlan, undefined);
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
      assert.equal(
        replay.replaySnapshot.provisionerPlan?.artifactPath,
        result.record.provisionerPlan?.artifactPath,
      );
      assert.equal(
        replay.replaySnapshot.provisionerPlan?.fingerprint,
        result.record.provisionerPlan?.fingerprint,
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
      await fsp.access(replay.replaySnapshot.provisionerPlan!.artifactPath);
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
    const recordsRoot = path.join(tmp, "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    await writeReplayArtifact(artifactDir, "demoapp");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-replay-contract-2",
      artifactIdentity: "artifact-replay-contract-2",
      artifactLineageId: "artifact-replay-contract-2",
    });
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot,
      fixedRoot: artifactDir,
    });
    try {
      const result = await submitReplaySourceRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths: { statePath: path.join(tmp, "platform-state.json"), hostRoot, recordsRoot },
        admissionEvidence,
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
        backendDatabaseUrl,
      });
      const replay = await resolveNixosSharedHostReplaySource({
        recordsRoot,
        backendDatabaseUrl,
        deployRunId: result.record.deployRunId,
      });
      await fsp.rm(Object.values(replay.componentArtifactDirs)[0]!, {
        recursive: true,
        force: true,
      });
      await assert.rejects(
        resolveNixosSharedHostReplaySource({
          recordsRoot,
          backendDatabaseUrl,
          deployRunId: result.record.deployRunId,
        }),
        /recorded exact artifact is unavailable/,
      );
    } finally {
      await server.close();
    }
  });
});

test("nixos-shared-host replay snapshots preserve SSR runtime-contract provenance", async () => {
  await runInTemp("nixos-shared-host-replay-ssr-contract", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      component: { kind: "ssr-webapp", target: "//test-workspace/apps/demoapp:app" },
      publisher: { type: "nixos-shared-host-ssr-webapp" },
      runtime: {
        appName: "demoapp",
        containerPort: 3000,
        healthPath: "/healthz",
        runtimeContract: {
          type: "node-dist-server-v1",
          framework: "vite",
          serverEntry: "dist/server/index.js",
          clientDir: "dist/client",
          servingTopology: "single-host-node-with-nginx",
          environmentNeutralBuild: true,
          runtimeConfigInjection: "runtime_config_requirements",
          secretInjection: "secret_requirements",
        },
      } as any,
    });
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    await writeSsrArtifact(artifactDir, "<html>ok</html>\n");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-replay-contract-3",
      artifactIdentity: "artifact-replay-contract-3",
      artifactLineageId: "artifact-replay-contract-3",
    });
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot,
      fixedRoot: artifactDir,
    });
    try {
      const result = await submitReplaySourceRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths: { statePath: path.join(tmp, "platform-state.json"), hostRoot, recordsRoot },
        admissionEvidence,
        smokeConnectOverride: {
          protocol: "http:",
          hostname: "127.0.0.1",
          port: server.port,
        },
        backendDatabaseUrl,
      });
      const replay = await resolveNixosSharedHostReplaySource({
        recordsRoot,
        backendDatabaseUrl,
        deployRunId: result.record.deployRunId,
      });
      assert.equal(
        (replay.replaySnapshot.deployment.components[0] as any).runtime.runtimeContract.framework,
        "vite",
      );
      assert.equal(replay.replaySnapshot.publishInput.components[0]?.artifact.kind, "ssr-webapp");
    } finally {
      await server.close();
    }
  });
});
