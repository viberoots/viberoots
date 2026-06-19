#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime";
import { runInTemp } from "../lib/test-helpers";
import {
  installClientProfile,
  prepareRemoteExecFixture,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { readBackendSnapshot } from "./nixos-shared-host.control-plane.helpers";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

const CONTROL_PLANE_TOKEN = "test-control-plane-token";

test("remote deploy stages the artifact, runs deploy remotely, writes remote records, and cleans up by default", async () => {
  await runInTemp("nixos-shared-host-remote-exec", async (tmp, $) => {
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
      artifactFiles: { "index.html": "<html>pleomino</html>\n", healthz: "ok\n" },
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
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --admission-evidence-json ${admissionEvidencePath} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.executionMode, "remote-profile");
      assert.equal(summary.stagedArtifactCleanup, "removed");
      assert.equal(summary.retentionRequested, false);
      assert.equal(summary.controlPlane.finalOutcome, "succeeded");
      assert.equal(summary.remoteRecordsRoot, remoteRecordsRoot);
      const record = summary.controlPlane.record;
      assert.equal(record.finalOutcome, "succeeded");
      assert.equal(record.controlPlane.lockScope, "nixos-shared-host:default:pleomino");
      const snapshot = await readBackendSnapshot(
        remoteRecordsRoot,
        String(record.controlPlane.submissionId),
      );
      assert.equal(snapshot.deploymentId, "pleomino-dev");
      assert.equal(snapshot.executionSnapshotObject?.provenance?.payloadKind, "execution-snapshot");
      assert.equal(snapshot.artifactObjects?.length, 1);
      const liveIndex = path.join(
        nixosSharedHostContainerRoot(remoteRuntimeRoot, deployment.providerTarget.containerName),
        "srv/static-app/live/index.html",
      );
      assert.equal(await fsp.readFile(liveIndex, "utf8"), "<html>pleomino</html>\n");
      await assert.rejects(fsp.access(summary.stagedArtifactPath));
    } finally {
      await worker.close();
      await controlPlane.close();
      await server.close();
    }
  });
});

test("remote deploy retains the staged artifact when retention is requested explicitly", async () => {
  await runInTemp("nixos-shared-host-remote-retain", async (tmp, $) => {
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
      artifactFiles: { "index.html": "<html>retain</html>\n", healthz: "ok\n" },
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
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --admission-evidence-json ${admissionEvidencePath} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --retain-remote-artifact --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.stagedArtifactCleanup, "retained");
      assert.equal(summary.retentionRequested, true);
      assert.equal(
        await fsp.readFile(path.join(summary.stagedArtifactPath, "index.html"), "utf8"),
        "<html>retain</html>\n",
      );
    } finally {
      await worker.close();
      await controlPlane.close();
      await server.close();
    }
  });
});

test("remote deploy fails closed when the reviewed remote repo checkout is missing", async () => {
  await runInTemp("nixos-shared-host-remote-missing-repo", async (tmp, $) => {
    const { env, artifactDir, admissionEvidencePath, profileRoot } = await prepareRemoteExecFixture(
      {
        tmp,
        $,
        artifactFiles: { "index.html": "<html>missing</html>\n", healthz: "ok\n" },
        remoteRepoPath: path.join(tmp, "does-not-exist"),
      },
    );
    const result = await $({
      cwd: tmp,
      env: remoteExecEnv(env),
    })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --admission-evidence-json ${admissionEvidencePath} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir}`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /remote repo preflight over SSH failed/);
    assert.match(String(result.stderr), /missing reviewed remote repo checkout/);
  });
});

test("remote deploy reports missing control-plane token before SSH preflight", async () => {
  await runInTemp("nixos-shared-host-remote-missing-token", async (tmp, $) => {
    const { env, artifactDir, admissionEvidencePath, profileRoot } = await prepareRemoteExecFixture(
      {
        tmp,
        $,
        artifactFiles: { "index.html": "<html>missing-token</html>\n", healthz: "ok\n" },
      },
    );
    const result = await $({
      cwd: tmp,
      env: remoteExecEnv(env, {
        VBR_DEPLOY_CONTROL_PLANE_TOKEN: "",
        FAKE_SSH_FAIL: "1",
      }),
    })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --admission-evidence-json ${admissionEvidencePath} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir}`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /requires VBR_DEPLOY_CONTROL_PLANE_TOKEN to be set/);
    assert.doesNotMatch(String(result.stderr), /fake ssh transport failure/);
  });
});
