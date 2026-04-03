#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";
import { installFakeRemoteTransport } from "./nixos-shared-host.remote-transport.fake.ts";

function pleominoDeploymentFixture() {
  return nixosSharedHostDeploymentFixture({
    deploymentId: "pleomino-dev",
    label: "//projects/deployments/pleomino-dev:deploy",
    component: { target: "//projects/apps/pleomino:app" },
    runtime: { appName: "pleomino", containerPort: 3000, healthPath: "/healthz" },
  });
}

async function writeArtifact(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, body, "utf8");
  }
}

async function installClientProfile(
  $: any,
  profileRoot: string,
  remoteRepoPath: string,
  remoteStatePath: string,
  remoteRuntimeRoot: string,
  remoteRecordsRoot: string,
): Promise<void> {
  await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${profileRoot} --profile mini --destination mini --remote-repo-path ${remoteRepoPath} --remote-state-path ${remoteStatePath} --remote-runtime-root ${remoteRuntimeRoot} --remote-records-root ${remoteRecordsRoot} --ssh-mode ssh`;
}

async function installReviewedPleominoTargets(tmp: string): Promise<void> {
  const appTargetsPath = path.join(tmp, "projects", "apps", "pleomino", "TARGETS");
  const deployTargetsPath = path.join(tmp, "projects", "deployments", "pleomino-dev", "TARGETS");
  await fsp.mkdir(path.dirname(appTargetsPath), { recursive: true });
  await fsp.mkdir(path.dirname(deployTargetsPath), { recursive: true });
  await fsp.writeFile(
    appTargetsPath,
    [
      'load("@prelude//:rules.bzl", "genrule")',
      "",
      "genrule(",
      '    name = "app",',
      '    out = "app.txt",',
      '    cmd = "printf pleomino > $OUT",',
      '    labels = ["kind:app", "webapp:static"],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    deployTargetsPath,
    [
      'load("//build-tools/deployments:defs.bzl", "nixos_shared_host_static_webapp_deployment")',
      "",
      "nixos_shared_host_static_webapp_deployment(",
      '    name = "deploy",',
      '    component = "//projects/apps/pleomino:app",',
      '    app_name = "pleomino",',
      "    container_port = 3000,",
      '    health_path = "/healthz",',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function prepareReviewedRemoteHostPaths(opts: {
  remoteStatePath: string;
  remoteRuntimeRoot: string;
  remoteRecordsRoot: string;
}): Promise<void> {
  await Promise.all([
    fsp.mkdir(path.dirname(opts.remoteStatePath), { recursive: true }),
    fsp.mkdir(opts.remoteRuntimeRoot, { recursive: true }),
    fsp.mkdir(opts.remoteRecordsRoot, { recursive: true }),
  ]);
}

async function listRunRecords(recordsRoot: string): Promise<string[]> {
  const runsDir = path.join(recordsRoot, "runs");
  try {
    return (await fsp.readdir(runsDir)).sort();
  } catch {
    return [];
  }
}

test("remote deploy stages the artifact, runs deploy remotely, writes remote records, and cleans up by default", async () => {
  await runInTemp("nixos-shared-host-remote-exec", async (tmp, $) => {
    const deployment = pleominoDeploymentFixture();
    const { env } = await installFakeRemoteTransport(tmp);
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    const remoteRuntimeRoot = path.join(tmp, "remote-runtime");
    const remoteRecordsRoot = path.join(tmp, "remote-records");
    const remoteStatePath = path.join(tmp, "remote-state", "platform-state.json");
    await installReviewedPleominoTargets(tmp);
    await prepareReviewedRemoteHostPaths({
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    });
    await writeArtifact(artifactDir, { "index.html": "<html>pleomino</html>\n", healthz: "ok\n" });
    await installClientProfile(
      $,
      profileRoot,
      tmp,
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    );
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      const result = await $({
        cwd: tmp,
        env: {
          ...env,
          IN_NIX_SHELL: "1",
        },
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.executionMode, "remote-profile");
      assert.equal(summary.stagedArtifactCleanup, "removed");
      assert.equal(summary.retentionRequested, false);
      assert.equal(summary.remoteDeployResult.finalOutcome, "succeeded");
      assert.equal(summary.remoteDeployResult.publicUrl, "https://pleomino.apps.kilty.io/");
      assert.equal(summary.remoteRecordsRoot, remoteRecordsRoot);
      const record = JSON.parse(await fsp.readFile(summary.remoteDeployResult.recordPath, "utf8"));
      assert.equal(record.finalOutcome, "succeeded");
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
    const deployment = pleominoDeploymentFixture();
    const { env } = await installFakeRemoteTransport(tmp);
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    const remoteRuntimeRoot = path.join(tmp, "remote-runtime");
    const remoteRecordsRoot = path.join(tmp, "remote-records");
    const remoteStatePath = path.join(tmp, "remote-state", "platform-state.json");
    await installReviewedPleominoTargets(tmp);
    await prepareReviewedRemoteHostPaths({
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    });
    await writeArtifact(artifactDir, { "index.html": "<html>retain</html>\n", healthz: "ok\n" });
    await installClientProfile(
      $,
      profileRoot,
      tmp,
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    );
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      const result = await $({
        cwd: tmp,
        env: {
          ...env,
          IN_NIX_SHELL: "1",
        },
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --retain-remote-artifact --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
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
    const { env } = await installFakeRemoteTransport(tmp);
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    const remoteRuntimeRoot = path.join(tmp, "remote-runtime");
    const remoteRecordsRoot = path.join(tmp, "remote-records");
    const remoteStatePath = path.join(tmp, "remote-state", "platform-state.json");
    await installReviewedPleominoTargets(tmp);
    await prepareReviewedRemoteHostPaths({
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    });
    await writeArtifact(artifactDir, { "index.html": "<html>missing</html>\n", healthz: "ok\n" });
    await installClientProfile(
      $,
      profileRoot,
      path.join(tmp, "does-not-exist"),
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    );
    const result = await $({
      cwd: tmp,
      env: {
        ...env,
        IN_NIX_SHELL: "1",
      },
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir}`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /remote repo preflight failed/);
    assert.match(String(result.stderr), /missing reviewed remote repo checkout/);
  });
});

test("remote deploy fails closed on artifact staging failure and remote transport failure", async () => {
  await runInTemp("nixos-shared-host-remote-stage-failure", async (tmp, $) => {
    const { env } = await installFakeRemoteTransport(tmp);
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    const remoteRuntimeRoot = path.join(tmp, "remote-runtime");
    const remoteRecordsRoot = path.join(tmp, "remote-records");
    const remoteStatePath = path.join(tmp, "remote-state", "platform-state.json");
    await installReviewedPleominoTargets(tmp);
    await prepareReviewedRemoteHostPaths({
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    });
    await writeArtifact(artifactDir, { "index.html": "<html>fail</html>\n", healthz: "ok\n" });
    await installClientProfile(
      $,
      profileRoot,
      tmp,
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    );
    const stageFailure = await $({
      cwd: tmp,
      env: {
        ...env,
        FAKE_RSYNC_FAIL: "1",
        IN_NIX_SHELL: "1",
      },
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir}`.nothrow();
    assert.notEqual(stageFailure.exitCode, 0);
    assert.match(String(stageFailure.stderr), /remote artifact staging failed/);
    const transportFailure = await $({
      cwd: tmp,
      env: {
        ...env,
        FAKE_SSH_FAIL: "1",
        IN_NIX_SHELL: "1",
      },
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir}`.nothrow();
    assert.notEqual(transportFailure.exitCode, 0);
    assert.match(String(transportFailure.stderr), /fake ssh transport failure/);
  });
});

test("remote deploy propagates remote deploy failures and still writes reviewed remote records", async () => {
  await runInTemp("nixos-shared-host-remote-deploy-failure", async (tmp, $) => {
    const deployment = pleominoDeploymentFixture();
    const { env } = await installFakeRemoteTransport(tmp);
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    const remoteRuntimeRoot = path.join(tmp, "remote-runtime");
    const remoteRecordsRoot = path.join(tmp, "remote-records");
    const remoteStatePath = path.join(tmp, "remote-state", "platform-state.json");
    await installReviewedPleominoTargets(tmp);
    await prepareReviewedRemoteHostPaths({
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    });
    await writeArtifact(artifactDir, { "index.html": "<html>no-health</html>\n" });
    await installClientProfile(
      $,
      profileRoot,
      tmp,
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    );
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      const result = await $({
        cwd: tmp,
        env: {
          ...env,
          IN_NIX_SHELL: "1",
        },
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`.nothrow();
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
