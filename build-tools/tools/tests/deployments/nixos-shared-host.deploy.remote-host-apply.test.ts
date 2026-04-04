#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import { createNixosSharedHostInstallFixture } from "./nixos-shared-host.install.fixture.ts";
import {
  installManagedRemoteHost,
  listRunRecords,
  prepareRemoteExecFixture,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

test("remote deploy can run reviewed host apply explicitly after a successful deploy", async () => {
  await runInTemp("nixos-shared-host-remote-host-apply", async (tmp, $) => {
    const { deployment, env, artifactDir, profileRoot, remoteRuntimeRoot } =
      await prepareRemoteExecFixture({
        tmp,
        $,
        artifactFiles: { "index.html": "<html>apply</html>\n", healthz: "ok\n" },
      });
    const rebuildLog = path.join(tmp, "nixos-rebuild.log");
    const fixture = await installManagedRemoteHost($, tmp, "managed-dropin");
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      const result = await $({
        cwd: tmp,
        env: remoteExecEnv(env, {
          FAKE_NIXOS_REBUILD_LOG: rebuildLog,
          NIXOS_SHARED_HOST_SERVER_ROOT: fixture.hostRoot,
        }),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --apply-host --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.remoteDeployResult.finalOutcome, "succeeded");
      assert.equal(summary.hostApply.selectedMode, "switch");
      assert.equal(summary.hostApply.result.mode, "switch");
      assert.equal(summary.hostApply.result.applied, true);
      assert.match(await fsp.readFile(rebuildLog, "utf8"), /switch/);
    } finally {
      await server.close();
    }
  });
});

test("remote deploy supports explicit dry-run host apply without silently switching the host", async () => {
  await runInTemp("nixos-shared-host-remote-host-apply-dry-run", async (tmp, $) => {
    const { deployment, env, artifactDir, profileRoot, remoteRuntimeRoot } =
      await prepareRemoteExecFixture({
        tmp,
        $,
        artifactFiles: {
          "index.html": "<html>apply-dry-run</html>\n",
          healthz: "ok\n",
        },
      });
    const rebuildLog = path.join(tmp, "nixos-rebuild.log");
    const fixture = await installManagedRemoteHost($, tmp, "managed-dropin");
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      const result = await $({
        cwd: tmp,
        env: remoteExecEnv(env, {
          FAKE_NIXOS_REBUILD_LOG: rebuildLog,
          NIXOS_SHARED_HOST_SERVER_ROOT: fixture.hostRoot,
        }),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --apply-host-dry-run --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.hostApply.selectedMode, "dry-run");
      assert.equal(summary.hostApply.result.mode, "dry-run");
      assert.equal(summary.hostApply.result.applied, false);
      assert.match(await fsp.readFile(rebuildLog, "utf8"), /dry-activate/);
    } finally {
      await server.close();
    }
  });
});

test("remote host apply fails closed when the selected server is unmanaged or missing wiring", async () => {
  await runInTemp("nixos-shared-host-remote-host-apply-preflight", async (tmp, $) => {
    const { deployment, env, artifactDir, profileRoot, remoteRuntimeRoot } =
      await prepareRemoteExecFixture({
        tmp,
        $,
        artifactFiles: { "index.html": "<html>preflight</html>\n", healthz: "ok\n" },
      });
    const unmanagedFixture = await createNixosSharedHostInstallFixture({
      root: path.join(tmp, "unmanaged"),
      topology: "plain",
      withExtraImports: true,
    });
    const unmanagedServer = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      const unmanaged = await $({
        cwd: tmp,
        env: remoteExecEnv(env, { NIXOS_SHARED_HOST_SERVER_ROOT: unmanagedFixture.hostRoot }),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --apply-host --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(unmanagedServer.port)} --smoke-connect-protocol https:`.nothrow();
      assert.notEqual(unmanaged.exitCode, 0);
      assert.match(String(unmanaged.stderr), /remote host apply failed/);
      assert.match(String(unmanaged.stderr), /not a managed nixos-shared-host install/);
    } finally {
      await unmanagedServer.close();
    }
    const missingWiringFixture = await installManagedRemoteHost(
      $,
      path.join(tmp, "missing-wiring"),
      "managed-manual-wire",
    );
    const missingWiringServer = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      const missingWiring = await $({
        cwd: tmp,
        env: remoteExecEnv(env, {
          NIXOS_SHARED_HOST_SERVER_ROOT: missingWiringFixture.hostRoot,
        }),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --apply-host --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(missingWiringServer.port)} --smoke-connect-protocol https:`.nothrow();
      assert.notEqual(missingWiring.exitCode, 0);
      assert.match(String(missingWiring.stderr), /remote host apply failed/);
      assert.match(String(missingWiring.stderr), /managed wiring is missing/);
    } finally {
      await missingWiringServer.close();
    }
  });
});

test("remote host apply surfaces apply failures without reporting a false deploy success", async () => {
  await runInTemp("nixos-shared-host-remote-host-apply-failure", async (tmp, $) => {
    const { deployment, env, artifactDir, profileRoot, remoteRuntimeRoot, remoteRecordsRoot } =
      await prepareRemoteExecFixture({
        tmp,
        $,
        artifactFiles: { "index.html": "<html>apply-fail</html>\n", healthz: "ok\n" },
      });
    const fixture = await installManagedRemoteHost($, tmp, "managed-dropin");
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      const result = await $({
        cwd: tmp,
        env: remoteExecEnv(env, {
          FAKE_NIXOS_REBUILD_FAIL: "1",
          NIXOS_SHARED_HOST_SERVER_ROOT: fixture.hostRoot,
        }),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --apply-host --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`.nothrow();
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), /remote host apply failed/);
      assert.match(String(result.stderr), /fake nixos-rebuild failure/);
      assert.match(String(result.stderr), /remote deploy record:/);
      const [recordName] = await listRunRecords(remoteRecordsRoot);
      assert.ok(recordName);
      const record = JSON.parse(
        await fsp.readFile(path.join(remoteRecordsRoot, "runs", recordName), "utf8"),
      );
      assert.equal(record.finalOutcome, "succeeded");
    } finally {
      await server.close();
    }
  });
});
