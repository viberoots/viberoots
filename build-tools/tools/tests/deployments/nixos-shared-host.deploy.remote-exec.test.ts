#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";
import { createNixosSharedHostInstallFixture } from "./nixos-shared-host.install.fixture.ts";
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

async function installManagedRemoteHost(
  $: any,
  tmp: string,
  mode: "managed-dropin" | "managed-manual-wire",
) {
  const fixture = await createNixosSharedHostInstallFixture({
    root: tmp,
    topology: "plain",
    withExtraImports: true,
  });
  await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts server install --server-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode ${mode}`;
  return fixture;
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
      assert.equal(record.controlPlane.lockScope, "nixos-shared-host:default:pleomino");
      const snapshot = JSON.parse(
        await fsp.readFile(record.controlPlane.executionSnapshotPath, "utf8"),
      );
      assert.equal(snapshot.deploymentLabel, "//projects/deployments/pleomino-dev:deploy");
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

test("remote deploy can run reviewed host apply explicitly after a successful deploy", async () => {
  await runInTemp("nixos-shared-host-remote-host-apply", async (tmp, $) => {
    const deployment = pleominoDeploymentFixture();
    const { env } = await installFakeRemoteTransport(tmp);
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    const remoteRuntimeRoot = path.join(tmp, "remote-runtime");
    const remoteRecordsRoot = path.join(tmp, "remote-records");
    const remoteStatePath = path.join(tmp, "remote-state", "platform-state.json");
    const rebuildLog = path.join(tmp, "nixos-rebuild.log");
    const fixture = await installManagedRemoteHost($, tmp, "managed-dropin");
    await installReviewedPleominoTargets(tmp);
    await prepareReviewedRemoteHostPaths({
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    });
    await writeArtifact(artifactDir, { "index.html": "<html>apply</html>\n", healthz: "ok\n" });
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
          FAKE_NIXOS_REBUILD_LOG: rebuildLog,
          IN_NIX_SHELL: "1",
          NIXOS_SHARED_HOST_SERVER_ROOT: fixture.hostRoot,
        },
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --apply-host --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
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
    const deployment = pleominoDeploymentFixture();
    const { env } = await installFakeRemoteTransport(tmp);
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    const remoteRuntimeRoot = path.join(tmp, "remote-runtime");
    const remoteRecordsRoot = path.join(tmp, "remote-records");
    const remoteStatePath = path.join(tmp, "remote-state", "platform-state.json");
    const rebuildLog = path.join(tmp, "nixos-rebuild.log");
    const fixture = await installManagedRemoteHost($, tmp, "managed-dropin");
    await installReviewedPleominoTargets(tmp);
    await prepareReviewedRemoteHostPaths({
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    });
    await writeArtifact(artifactDir, {
      "index.html": "<html>apply-dry-run</html>\n",
      healthz: "ok\n",
    });
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
          FAKE_NIXOS_REBUILD_LOG: rebuildLog,
          IN_NIX_SHELL: "1",
          NIXOS_SHARED_HOST_SERVER_ROOT: fixture.hostRoot,
        },
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --apply-host-dry-run --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
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
    await writeArtifact(artifactDir, { "index.html": "<html>preflight</html>\n", healthz: "ok\n" });
    await installClientProfile(
      $,
      profileRoot,
      tmp,
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    );
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
        env: {
          ...env,
          IN_NIX_SHELL: "1",
          NIXOS_SHARED_HOST_SERVER_ROOT: unmanagedFixture.hostRoot,
        },
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --apply-host --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(unmanagedServer.port)} --smoke-connect-protocol https:`.nothrow();
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
        env: {
          ...env,
          IN_NIX_SHELL: "1",
          NIXOS_SHARED_HOST_SERVER_ROOT: missingWiringFixture.hostRoot,
        },
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --apply-host --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(missingWiringServer.port)} --smoke-connect-protocol https:`.nothrow();
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
    const deployment = pleominoDeploymentFixture();
    const { env } = await installFakeRemoteTransport(tmp);
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    const remoteRuntimeRoot = path.join(tmp, "remote-runtime");
    const remoteRecordsRoot = path.join(tmp, "remote-records");
    const remoteStatePath = path.join(tmp, "remote-state", "platform-state.json");
    const fixture = await installManagedRemoteHost($, tmp, "managed-dropin");
    await installReviewedPleominoTargets(tmp);
    await prepareReviewedRemoteHostPaths({
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    });
    await writeArtifact(artifactDir, {
      "index.html": "<html>apply-fail</html>\n",
      healthz: "ok\n",
    });
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
          FAKE_NIXOS_REBUILD_FAIL: "1",
          IN_NIX_SHELL: "1",
          NIXOS_SHARED_HOST_SERVER_ROOT: fixture.hostRoot,
        },
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --apply-host --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`.nothrow();
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
