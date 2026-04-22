#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRemoteArtifactStageArgv,
  buildRemoteCleanupScript,
  buildRemoteDeployScript,
  buildRemoteHostApplyScript,
  buildRemoteRepoPreflightScript,
  buildRemoteSshArgv,
  buildRemoteStagePrepareScript,
} from "../../deployments/nixos-shared-host-remote-shell.ts";
import {
  REMOTE_SSH_IDENTITY_FILE_ENV,
  REMOTE_SSH_KNOWN_HOSTS_FILE_ENV,
} from "../../deployments/nixos-shared-host-remote-ssh.ts";
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
  remoteStatePath: "/var/lib/deployment-host/platform-state.json",
  remoteRuntimeRoot: "/var/lib/deployment-host/runtime",
  remoteRecordsRoot: "/var/lib/deployment-host/records",
  remoteArtifactStageRoot: "/var/lib/deployment-host/runtime/.deploy-artifacts",
  artifactSource: {
    kind: "explicit-artifact-dir",
    localArtifactDir: "/tmp/local-artifact",
    remoteTransportRequired: true,
  },
  stagedArtifactCleanup: {
    defaultMode: "remove",
    retainFlag: "--retain-remote-artifact",
  },
  hostApply: {
    supported: true,
    explicitOptInRequired: true,
    selectedMode: "skip",
    remoteConfigRoot: "/etc/nixos",
    remoteManagedRoot: "/etc/nixos/deployment-host",
  },
  hostApplyExpectedLater: true,
};

test("remote SSH transport assembles reviewed preflight, staging, deploy, and cleanup commands", () => {
  const remoteArtifactPath = createNixosSharedHostRemoteArtifactPath(plan, "remote-123");
  assert.equal(
    remoteArtifactPath,
    "/var/lib/deployment-host/runtime/.deploy-artifacts/projects-deployments-pleomino-dev-deploy/remote-123",
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
    "mini:/var/lib/deployment-host/runtime/.deploy-artifacts/projects-deployments-pleomino-dev-deploy/remote-123/",
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
    /--artifact-dir '\/var\/lib\/deployment-host\/runtime\/\.deploy-artifacts/,
  );
  assert.match(deploy[4] || "", /--smoke-connect-host '127\.0\.0\.1'/);
  assert.match(deploy[4] || "", /--smoke-connect-port '3443'/);
  const cleanup = buildRemoteSshArgv(
    plan.destination,
    buildRemoteCleanupScript(remoteArtifactPath),
  );
  assert.match(cleanup[4] || "", /rm -rf --/);
});

test("remote SSH transport assembles reviewed host-apply commands for switch and dry-run", () => {
  const switchPlan: NixosSharedHostRemotePlan = {
    ...plan,
    hostApply: {
      ...plan.hostApply,
      selectedMode: "switch",
    },
    hostApplyExpectedLater: false,
  };
  const switchApply = buildRemoteSshArgv(
    switchPlan.destination,
    buildRemoteHostApplyScript(switchPlan),
  );
  assert.match(switchApply[4] || "", /nixos-shared-host-host-apply\.ts/);
  assert.match(switchApply[4] || "", /--config-root '\/etc\/nixos'/);
  assert.match(switchApply[4] || "", /--managed-root '\/etc\/nixos\/deployment-host'/);
  assert.match(
    switchApply[4] || "",
    /--expected-state-path '\/var\/lib\/deployment-host\/platform-state\.json'/,
  );
  const dryRunPlan: NixosSharedHostRemotePlan = {
    ...switchPlan,
    hostApply: {
      ...switchPlan.hostApply,
      selectedMode: "dry-run",
    },
    hostApplyExpectedLater: true,
  };
  const dryRunApply = buildRemoteSshArgv(
    dryRunPlan.destination,
    buildRemoteHostApplyScript(dryRunPlan),
  );
  assert.match(dryRunApply[4] || "", /--dry-run/);
});

test("remote SSH transport adds reviewed non-interactive auth options when Jenkins auth is present", () => {
  const previousIdentity = process.env[REMOTE_SSH_IDENTITY_FILE_ENV];
  const previousKnownHosts = process.env[REMOTE_SSH_KNOWN_HOSTS_FILE_ENV];
  process.env[REMOTE_SSH_IDENTITY_FILE_ENV] = "/tmp/jenkins-id";
  process.env[REMOTE_SSH_KNOWN_HOSTS_FILE_ENV] = "/tmp/known-hosts";
  try {
    const ssh = buildRemoteSshArgv(plan.destination, "echo ok");
    assert.deepEqual(ssh.slice(0, 11), [
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "UserKnownHostsFile=/tmp/known-hosts",
      "-i",
      "/tmp/jenkins-id",
    ]);
    const stage = buildRemoteArtifactStageArgv(
      "/tmp/local-artifact",
      plan.destination,
      "/tmp/remote",
    );
    assert.equal(stage[3], "-e");
    assert.match(stage[4] || "", /BatchMode=yes/);
    assert.match(stage[4] || "", /UserKnownHostsFile=\/tmp\/known-hosts/);
    assert.match(stage[4] || "", /\/tmp\/jenkins-id/);
  } finally {
    if (previousIdentity == null) {
      delete process.env[REMOTE_SSH_IDENTITY_FILE_ENV];
    } else {
      process.env[REMOTE_SSH_IDENTITY_FILE_ENV] = previousIdentity;
    }
    if (previousKnownHosts == null) {
      delete process.env[REMOTE_SSH_KNOWN_HOSTS_FILE_ENV];
    } else {
      process.env[REMOTE_SSH_KNOWN_HOSTS_FILE_ENV] = previousKnownHosts;
    }
  }
});
