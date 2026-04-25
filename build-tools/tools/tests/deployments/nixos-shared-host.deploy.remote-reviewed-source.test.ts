#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  installClientProfile,
  prepareRemoteExecFixture,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers.ts";

const CONTROL_PLANE_TOKEN = "test-control-plane-token";

test("remote deploy surfaces reviewed-source mismatch guidance when the local checked commit drifts from the service snapshot", async () => {
  await runInTemp("nixos-shared-host-remote-reviewed-source-mismatch", async (tmp, $) => {
    const { env, artifactDir, profileRoot, remoteRuntimeRoot, remoteRecordsRoot, remoteStatePath } =
      await prepareRemoteExecFixture({
        tmp,
        $,
        artifactFiles: { "index.html": "<html>mismatch</html>\n", healthz: "ok\n" },
      });
    const sharedTargetsPath = path.join(
      tmp,
      "projects",
      "deployments",
      "pleomino-shared",
      "TARGETS",
    );
    await fsp.writeFile(
      sharedTargetsPath,
      (await fsp.readFile(sharedTargetsPath, "utf8"))
        .replace('"required_checks": "",', '"required_checks": "deploy/pleomino-dev",')
        .replace("    required_checks = [],", '    required_checks = ["deploy/pleomino-dev"],'),
      "utf8",
    );
    const serviceRevision = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse env/pleomino/dev`).stdout,
    ).trim();
    await fsp.writeFile(path.join(tmp, "local-drift.txt"), "local-drift\n", "utf8");
    await $({ cwd: tmp, stdio: "pipe" })`git add local-drift.txt`;
    await $({ cwd: tmp, stdio: "pipe" })`git commit -m local-drift`;
    await $({ cwd: tmp, stdio: "pipe" })`git branch -f env/pleomino/dev HEAD`;
    const clientRevision = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse env/pleomino/dev`).stdout,
    ).trim();
    assert.notEqual(clientRevision, serviceRevision);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: {
        statePath: remoteStatePath,
        hostRoot: remoteRuntimeRoot,
        recordsRoot: remoteRecordsRoot,
      },
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(remoteRecordsRoot),
      token: CONTROL_PLANE_TOKEN,
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
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --mark-check-passed deploy/pleomino-dev`.nothrow();
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), /reviewed source mismatch for env\/pleomino\/dev/);
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
        /deployment branch is up to date and pushed before retrying/,
      );
      assert.match(String(result.stderr), new RegExp(`--mark-check-for-commit ${serviceRevision}`));
    } finally {
      await controlPlane.close();
    }
  });
});
