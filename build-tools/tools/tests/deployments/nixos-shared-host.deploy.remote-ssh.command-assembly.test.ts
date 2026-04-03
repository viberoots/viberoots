#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRemoteArtifactStageArgv,
  buildRemoteCleanupScript,
  buildRemoteDeployScript,
  buildRemoteRepoPreflightScript,
  buildRemoteSshArgv,
  buildRemoteStagePrepareScript,
} from "../../deployments/nixos-shared-host-remote-shell.ts";
import { createNixosSharedHostRemoteArtifactPath } from "../../deployments/nixos-shared-host-remote-target.ts";
import type { NixosSharedHostRemotePlan } from "../../deployments/nixos-shared-host-remote-target.ts";

const plan: NixosSharedHostRemotePlan = {
  planMode: true,
  remoteExecutionImplemented: true,
  deploymentId: "pleomino-dev",
  deploymentLabel: "//projects/deployments/pleomino-dev:deploy",
  profileName: "mini",
  destination: "mini",
  transportMode: "ssh",
  remoteRepoPath: "/srv/common",
  remoteStatePath: "/var/lib/bucknix/nixos-shared-host/platform-state.json",
  remoteRuntimeRoot: "/var/lib/bucknix/nixos-shared-host/runtime",
  remoteRecordsRoot: "/var/lib/bucknix/nixos-shared-host/records",
  remoteArtifactStageRoot: "/var/lib/bucknix/nixos-shared-host/runtime/.deploy-artifacts",
  artifactSource: {
    kind: "explicit-artifact-dir",
    localArtifactDir: "/tmp/local-artifact",
    remoteTransportRequired: true,
  },
  stagedArtifactCleanup: {
    defaultMode: "remove",
    retainFlag: "--retain-remote-artifact",
  },
  hostApplyExpectedLater: true,
};

test("remote SSH transport assembles reviewed preflight, staging, deploy, and cleanup commands", () => {
  const remoteArtifactPath = createNixosSharedHostRemoteArtifactPath(plan, "remote-123");
  assert.equal(
    remoteArtifactPath,
    "/var/lib/bucknix/nixos-shared-host/runtime/.deploy-artifacts/projects-deployments-pleomino-dev-deploy/remote-123",
  );
  const preflight = buildRemoteSshArgv(plan.destination, buildRemoteRepoPreflightScript(plan));
  assert.deepEqual(preflight.slice(0, 4), ["ssh", "mini", "bash", "-lc"]);
  assert.match(preflight[4] || "", /missing reviewed remote repo checkout/);
  const stagePrepare = buildRemoteSshArgv(
    plan.destination,
    buildRemoteStagePrepareScript(remoteArtifactPath),
  );
  assert.match(stagePrepare[4] || "", /mkdir -p --/);
  const stage = buildRemoteArtifactStageArgv(
    "/tmp/local-artifact",
    plan.destination,
    remoteArtifactPath,
  );
  assert.deepEqual(stage, [
    "rsync",
    "-az",
    "--delete",
    "/tmp/local-artifact/",
    "mini:/var/lib/bucknix/nixos-shared-host/runtime/.deploy-artifacts/projects-deployments-pleomino-dev-deploy/remote-123/",
  ]);
  const deploy = buildRemoteSshArgv(
    plan.destination,
    buildRemoteDeployScript({
      plan,
      deploymentLabel: plan.deploymentLabel,
      remoteArtifactPath,
      smokeConnectOverride: {
        protocol: "https:",
        hostname: "127.0.0.1",
        port: 3443,
      },
    }),
  );
  assert.match(deploy[4] || "", /direnv exec \. build-tools\/tools\/bin\/deploy/);
  assert.match(
    deploy[4] || "",
    /--artifact-dir '\/var\/lib\/bucknix\/nixos-shared-host\/runtime\/\.deploy-artifacts/,
  );
  assert.match(deploy[4] || "", /--smoke-connect-host '127\.0\.0\.1'/);
  assert.match(deploy[4] || "", /--smoke-connect-port '3443'/);
  const cleanup = buildRemoteSshArgv(
    plan.destination,
    buildRemoteCleanupScript(remoteArtifactPath),
  );
  assert.match(cleanup[4] || "", /rm -rf --/);
});
