#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  listRunRecords,
  prepareRemoteExecFixture,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

test("remote deploy fails closed on artifact staging failure and remote transport failure", async () => {
  await runInTemp("nixos-shared-host-remote-stage-failure", async (tmp, $) => {
    const { env, artifactDir, profileRoot } = await prepareRemoteExecFixture({
      tmp,
      $,
      artifactFiles: { "index.html": "<html>fail</html>\n", healthz: "ok\n" },
    });
    const stageFailure = await $({
      cwd: tmp,
      env: remoteExecEnv(env, { FAKE_RSYNC_FAIL: "1" }),
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir}`.nothrow();
    assert.notEqual(stageFailure.exitCode, 0);
    assert.match(String(stageFailure.stderr), /remote artifact staging failed/);
    const transportFailure = await $({
      cwd: tmp,
      env: remoteExecEnv(env, { FAKE_SSH_FAIL: "1" }),
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir}`.nothrow();
    assert.notEqual(transportFailure.exitCode, 0);
    assert.match(String(transportFailure.stderr), /fake ssh transport failure/);
  });
});

test("remote deploy propagates remote deploy failures and still writes reviewed remote records", async () => {
  await runInTemp("nixos-shared-host-remote-deploy-failure", async (tmp, $) => {
    const { deployment, env, artifactDir, profileRoot, remoteRuntimeRoot, remoteRecordsRoot } =
      await prepareRemoteExecFixture({
        tmp,
        $,
        artifactFiles: { "index.html": "<html>no-health</html>\n" },
      });
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      const result = await $({
        cwd: tmp,
        env: remoteExecEnv(env),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`.nothrow();
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), /remote deploy failed/);
      assert.match(String(result.stderr), /smoke expected 200/);
      const [recordName] = await listRunRecords(remoteRecordsRoot);
      assert.ok(recordName);
      const record = JSON.parse(
        await fsp.readFile(path.join(remoteRecordsRoot, "runs", recordName), "utf8"),
      );
      assert.equal(record.finalOutcome, "smoke_failed_after_publish");
    } finally {
      await server.close();
    }
  });
});
