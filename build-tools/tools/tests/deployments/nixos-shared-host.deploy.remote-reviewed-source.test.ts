#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { runInTemp } from "../lib/test-helpers";
import {
  installClientProfile,
  prepareRemoteExecFixture,
  requirePleominoDevCheck,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { deploymentSourceRef } from "./nixos-shared-host.fixture";

const CONTROL_PLANE_TOKEN = "test-control-plane-token";

test("remote deploy surfaces reviewed-source mismatch guidance when the local checked commit drifts from the service snapshot", async () => {
  await runInTemp("nixos-shared-host-remote-reviewed-source-mismatch", async (tmp, $) => {
    const {
      deployment,
      env,
      artifactDir,
      profileRoot,
      remoteRuntimeRoot,
      remoteRecordsRoot,
      remoteStatePath,
    } = await prepareRemoteExecFixture({
      tmp,
      $,
      artifactFiles: { "index.html": "<html>mismatch</html>\n", healthz: "ok\n" },
    });
    await requirePleominoDevCheck(tmp);
    const sourceRef = deploymentSourceRef(deployment);
    const serviceRevision = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse ${sourceRef}`).stdout,
    ).trim();
    await fsp.writeFile(path.join(tmp, "local-drift.txt"), "local-drift\n", "utf8");
    await $({ cwd: tmp, stdio: "pipe" })`git add local-drift.txt`;
    await $({ cwd: tmp, stdio: "pipe" })`git commit -m local-drift`;
    const clientRevision = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse ${sourceRef}`).stdout,
    ).trim();
    assert.notEqual(clientRevision, serviceRevision);
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
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --admit-and-deploy deploy/pleomino-dev`.nothrow();
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), new RegExp(`reviewed source mismatch for ${sourceRef}`));
      assert.match(
        String(result.stderr),
        new RegExp(`clientExpectedSourceRevision=${clientRevision}`),
      );
      assert.match(
        String(result.stderr),
        new RegExp(`serviceReviewedSourceRevision=${serviceRevision}`),
      );
      assert.match(
        String(result.stderr),
        /that source ref is up to date and pushed before retrying/,
      );
      assert.match(String(result.stderr), new RegExp(`--admit-for-commit ${serviceRevision}`));
    } finally {
      await controlPlane.close();
    }
  });
});
