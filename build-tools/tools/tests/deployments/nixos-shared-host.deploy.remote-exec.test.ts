#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  prepareRemoteExecFixture,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

test("remote deploy stages the artifact, runs deploy remotely, writes remote records, and cleans up by default", async () => {
  await runInTemp("nixos-shared-host-remote-exec", async (tmp, $) => {
    const { deployment, env, artifactDir, profileRoot, remoteRuntimeRoot, remoteRecordsRoot } =
      await prepareRemoteExecFixture({
        tmp,
        $,
        artifactFiles: { "index.html": "<html>pleomino</html>\n", healthz: "ok\n" },
      });
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      const result = await $({
        cwd: tmp,
        env: remoteExecEnv(env),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.executionMode, "remote-profile");
      assert.equal(summary.stagedArtifactCleanup, "removed");
      assert.equal(summary.retentionRequested, false);
      assert.equal(summary.remoteDeployResult.finalOutcome, "succeeded");
      assert.equal(summary.remoteDeployResult.publicUrl, "https://pleomino.apps.kilty.io/");
      assert.equal(summary.remoteRecordsRoot, remoteRecordsRoot);
      const record = JSON.parse(await fsp.readFile(summary.remoteDeployResult.recordPath, "utf8"));
      assert.equal(record.finalOutcome, "succeeded");
      assert.equal(record.controlPlane.lockScope, "nixos-shared-host:default:pleomino");
      const snapshot = JSON.parse(
        await fsp.readFile(record.controlPlane.executionSnapshotPath, "utf8"),
      );
      assert.equal(snapshot.deploymentLabel, REVIEWED_PLEOMINO_DEPLOYMENT_LABEL);
      assert.equal(snapshot.providerTargetIdentity, "nixos-shared-host:default:pleomino");
      const liveIndex = path.join(
        nixosSharedHostContainerRoot(remoteRuntimeRoot, deployment.providerTarget.containerName),
        "srv/static-app/live/index.html",
      );
      assert.equal(await fsp.readFile(liveIndex, "utf8"), "<html>pleomino</html>\n");
      await assert.rejects(fsp.access(summary.stagedArtifactPath));
    } finally {
      await server.close();
    }
  });
});

test("remote deploy retains the staged artifact when retention is requested explicitly", async () => {
  await runInTemp("nixos-shared-host-remote-retain", async (tmp, $) => {
    const { deployment, env, artifactDir, profileRoot, remoteRuntimeRoot } =
      await prepareRemoteExecFixture({
        tmp,
        $,
        artifactFiles: { "index.html": "<html>retain</html>\n", healthz: "ok\n" },
      });
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      const result = await $({
        cwd: tmp,
        env: remoteExecEnv(env),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --retain-remote-artifact --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.stagedArtifactCleanup, "retained");
      assert.equal(summary.retentionRequested, true);
      assert.equal(
        await fsp.readFile(path.join(summary.stagedArtifactPath, "index.html"), "utf8"),
        "<html>retain</html>\n",
      );
    } finally {
      await server.close();
    }
  });
});

test("remote deploy fails closed when the reviewed remote repo checkout is missing", async () => {
  await runInTemp("nixos-shared-host-remote-missing-repo", async (tmp, $) => {
    const { env, artifactDir, profileRoot } = await prepareRemoteExecFixture({
      tmp,
      $,
      artifactFiles: { "index.html": "<html>missing</html>\n", healthz: "ok\n" },
      remoteRepoPath: path.join(tmp, "does-not-exist"),
    });
    const result = await $({
      cwd: tmp,
      env: remoteExecEnv(env),
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir}`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /remote repo preflight failed/);
    assert.match(String(result.stderr), /missing reviewed remote repo checkout/);
  });
});
