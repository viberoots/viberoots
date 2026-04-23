#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRemoteArtifactStageArgv,
  buildRemoteArtifactStageArgvWithFallback,
  buildRemoteCleanupScript,
  buildRemoteDeployScript,
  buildRemoteHostApplyScript,
  buildRemoteRepoPreflightScript,
  buildRemoteSshArgv,
  buildRemoteSshArgvWithFallback,
  buildRemoteStageFinalizeScript,
  buildRemoteStagePrepareScript,
} from "../../deployments/nixos-shared-host-remote-shell.ts";
import {
  REMOTE_SSH_IDENTITY_FILE_ENV,
  REMOTE_SSH_KNOWN_HOSTS_FILE_ENV,
} from "../../deployments/nixos-shared-host-remote-ssh.ts";
import { createNixosSharedHostRemoteArtifactPath } from "../../deployments/nixos-shared-host-remote-target.ts";
import {
  remoteSshCommandAssemblyPlan as plan,
  withReviewedSshEnv,
} from "./nixos-shared-host.remote-ssh.command-assembly.fixture.ts";

test("remote SSH transport assembles reviewed preflight, staging, deploy, and cleanup commands", () => {
  withReviewedSshEnv(() => {
    const remoteArtifactPath = createNixosSharedHostRemoteArtifactPath(plan, "remote-123");
    assert.equal(
      remoteArtifactPath,
      "/var/lib/deployment-host/runtime/.deploy-artifacts/projects-deployments-pleomino-dev-deploy/remote-123",
    );
    const preflight = buildRemoteSshArgv(plan.destination, buildRemoteRepoPreflightScript(plan));
    assert.equal(preflight.at(-2), "mini");
    assert.match(preflight.at(-1) || "", /^bash -lc '/);
    assert.match(preflight.at(-1) || "", /missing reviewed remote repo checkout/);
    const stagePrepare = buildRemoteSshArgv(
      plan.destination,
      buildRemoteStagePrepareScript(remoteArtifactPath),
    );
    assert.match(stagePrepare.at(-1) || "", /\.uploading/);
    const stage = buildRemoteArtifactStageArgv(
      "/tmp/local-artifact",
      plan.destination,
      `${remoteArtifactPath}.uploading`,
    );
    assert.equal(stage[3], "-e");
    assert.match(stage.at(-1) || "", /remote-123\.uploading\/$/);
    const finalize = buildRemoteSshArgv(
      plan.destination,
      buildRemoteStageFinalizeScript(remoteArtifactPath),
    );
    assert.match(finalize.at(-1) || "", /mv -- "\$tmp" "\$final"/);
    assert.match(finalize.at(-1) || "", /complete\.json/);
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
    assert.match(deploy.at(-1) || "", /direnv exec \. build-tools\/tools\/bin\/deploy/);
    assert.match(
      deploy.at(-1) || "",
      /--artifact-dir '"'"'\/var\/lib\/deployment-host\/runtime\/\.deploy-artifacts/,
    );
    assert.match(deploy.at(-1) || "", /--smoke-connect-host '"'"'127\.0\.0\.1'"'"'/);
    assert.match(deploy.at(-1) || "", /--smoke-connect-port '"'"'3443'"'"'/);
    const cleanup = buildRemoteSshArgv(
      plan.destination,
      buildRemoteCleanupScript(remoteArtifactPath),
    );
    assert.match(cleanup.at(-1) || "", /rm -rf --/);
  });
});

test("remote SSH transport assembles reviewed host-apply commands for switch and dry-run", () => {
  withReviewedSshEnv(() => {
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
    assert.match(switchApply.at(-1) || "", /nixos-shared-host-host-apply\.ts/);
    assert.match(switchApply.at(-1) || "", /--config-root '"'"'\/etc\/nixos'"'"'/);
    assert.match(
      switchApply.at(-1) || "",
      /--managed-root '"'"'\/etc\/nixos\/deployment-host'"'"'/,
    );
    assert.match(
      switchApply.at(-1) || "",
      /--expected-state-path '"'"'\/etc\/nixos\/deployment-host\/platform-state\.json'"'"'/,
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
    assert.match(dryRunApply.at(-1) || "", /--dry-run/);
  });
});

test("remote SSH transport adds reviewed non-interactive auth options when Jenkins auth is present", () => {
  withReviewedSshEnv(() => {
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
    assert.equal(ssh.at(-2), "mini");
    assert.equal(ssh.at(-1), "bash -lc 'echo ok'");
    const stage = buildRemoteArtifactStageArgv(
      "/tmp/local-artifact",
      plan.destination,
      "/tmp/remote",
    );
    assert.equal(stage[3], "-e");
    assert.match(stage[4] || "", /BatchMode=yes/);
    assert.match(stage[4] || "", /UserKnownHostsFile=\/tmp\/known-hosts/);
    assert.match(stage[4] || "", /\/tmp\/jenkins-id/);
  });
});

test("remote SSH transport rejects missing reviewed host-key configuration", () => {
  const previousIdentity = process.env[REMOTE_SSH_IDENTITY_FILE_ENV];
  const previousKnownHosts = process.env[REMOTE_SSH_KNOWN_HOSTS_FILE_ENV];
  delete process.env[REMOTE_SSH_IDENTITY_FILE_ENV];
  delete process.env[REMOTE_SSH_KNOWN_HOSTS_FILE_ENV];
  try {
    assert.throws(
      () => buildRemoteSshArgv(plan.destination, "echo ok"),
      /reviewed remote SSH auth requires/,
    );
  } finally {
    if (previousIdentity != null) process.env[REMOTE_SSH_IDENTITY_FILE_ENV] = previousIdentity;
    if (previousKnownHosts != null)
      process.env[REMOTE_SSH_KNOWN_HOSTS_FILE_ENV] = previousKnownHosts;
  }
});

test("remote SSH transport accepts reviewed profile defaults when env is unset", () => {
  const previousIdentity = process.env[REMOTE_SSH_IDENTITY_FILE_ENV];
  const previousKnownHosts = process.env[REMOTE_SSH_KNOWN_HOSTS_FILE_ENV];
  delete process.env[REMOTE_SSH_IDENTITY_FILE_ENV];
  delete process.env[REMOTE_SSH_KNOWN_HOSTS_FILE_ENV];
  try {
    const ssh = buildRemoteSshArgvWithFallback(plan.destination, "echo ok", {
      identityFile: "/tmp/profile-id",
      knownHostsFile: "/tmp/profile-known-hosts",
    });
    assert.deepEqual(ssh.slice(0, 11), [
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "UserKnownHostsFile=/tmp/profile-known-hosts",
      "-i",
      "/tmp/profile-id",
    ]);
    assert.equal(ssh.at(-2), "mini");
    assert.equal(ssh.at(-1), "bash -lc 'echo ok'");
    const stage = buildRemoteArtifactStageArgvWithFallback(
      "/tmp/local-artifact",
      plan.destination,
      "/tmp/remote",
      {
        identityFile: "/tmp/profile-id",
        knownHostsFile: "/tmp/profile-known-hosts",
      },
    );
    assert.equal(stage[3], "-e");
    assert.match(stage[4] || "", /UserKnownHostsFile=\/tmp\/profile-known-hosts/);
    assert.match(stage[4] || "", /\/tmp\/profile-id/);
  } finally {
    if (previousIdentity != null) process.env[REMOTE_SSH_IDENTITY_FILE_ENV] = previousIdentity;
    if (previousKnownHosts != null)
      process.env[REMOTE_SSH_KNOWN_HOSTS_FILE_ENV] = previousKnownHosts;
  }
});
