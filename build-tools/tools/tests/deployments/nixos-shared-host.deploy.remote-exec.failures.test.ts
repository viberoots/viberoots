#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { runInTemp } from "../lib/test-helpers";
import {
  installClientProfile,
  prepareRemoteExecFixture,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { readRecord, waitFor } from "./nixos-shared-host.control-plane.helpers";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

const CONTROL_PLANE_TOKEN = "test-control-plane-token";

test("remote deploy fails closed on artifact staging failure and remote transport failure", async () => {
  await runInTemp("nixos-shared-host-remote-stage-failure", async (tmp, $) => {
    const {
      env,
      artifactDir,
      admissionEvidencePath,
      profileRoot,
      remoteRuntimeRoot,
      remoteRecordsRoot,
      remoteStatePath,
    } = await prepareRemoteExecFixture({
      tmp,
      $,
      artifactFiles: { "index.html": "<html>fail</html>\n", healthz: "ok\n" },
    });
    const objectStore = memoryControlPlaneArtifactStore();
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: {
        statePath: remoteStatePath,
        hostRoot: remoteRuntimeRoot,
        recordsRoot: remoteRecordsRoot,
      },
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(remoteRecordsRoot),
      token: CONTROL_PLANE_TOKEN,
      objectStore,
    });
    await installClientProfile(
      $,
      profileRoot,
      tmp,
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
      controlPlane.url,
    );
    try {
      const stageFailure = await $({
        cwd: tmp,
        env: remoteExecEnv(env, { FAKE_RSYNC_FAIL: "1" }),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --admission-evidence-json ${admissionEvidencePath} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir}`.nothrow();
      assert.notEqual(stageFailure.exitCode, 0);
      assert.match(String(stageFailure.stderr), /remote artifact staging failed/);
      const transportFailure = await $({
        cwd: tmp,
        env: remoteExecEnv(env, { FAKE_SSH_FAIL: "1" }),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --admission-evidence-json ${admissionEvidencePath} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir}`.nothrow();
      assert.notEqual(transportFailure.exitCode, 0);
      assert.match(String(transportFailure.stderr), /fake ssh transport failure/);
    } finally {
      await controlPlane.close();
    }
  });
});

test("remote deploy propagates remote deploy failures and still writes reviewed remote records", async () => {
  await runInTemp("nixos-shared-host-remote-deploy-failure", async (tmp, $) => {
    const {
      deployment,
      env,
      artifactDir,
      admissionEvidencePath,
      profileRoot,
      remoteRuntimeRoot,
      remoteRecordsRoot,
      remoteStatePath,
    } = await prepareRemoteExecFixture({
      tmp,
      $,
      artifactFiles: { "index.html": "<html>no-health</html>\n" },
    });
    const objectStore = memoryControlPlaneArtifactStore();
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: {
        statePath: remoteStatePath,
        hostRoot: remoteRuntimeRoot,
        recordsRoot: remoteRecordsRoot,
      },
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(remoteRecordsRoot),
      token: CONTROL_PLANE_TOKEN,
      objectStore,
    });
    const worker = startNixosSharedHostControlPlaneWorkerLoop({
      workspaceRoot: tmp,
      recordsRoot: remoteRecordsRoot,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(remoteRecordsRoot),
      objectStore,
    });
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      await installClientProfile(
        $,
        profileRoot,
        tmp,
        remoteStatePath,
        remoteRuntimeRoot,
        remoteRecordsRoot,
        controlPlane.url,
      );
      const result = await $({
        cwd: tmp,
        env: remoteExecEnv(env),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --admission-evidence-json ${admissionEvidencePath} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`.nothrow();
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), /remote service submission/);
      assert.match(String(result.stderr), /smoke expected 200/);
      const deployRunId = String(result.stderr).match(/deployRunId=([A-Za-z0-9-]+)/)?.[1];
      assert.ok(deployRunId);
      const record = await waitFor(async () => {
        try {
          return await readRecord(controlPlane.url, deployRunId, CONTROL_PLANE_TOKEN);
        } catch {
          return null;
        }
      }, "timed out waiting for remote reviewed failure record");
      assert.equal(record.finalOutcome, "smoke_failed_after_publish");
    } finally {
      await worker.close();
      await controlPlane.close();
      await server.close();
    }
  });
});
