#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  installNixosSharedHostTargets,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";

async function installClientProfile(
  $: any,
  profileRoot: string,
  sshMode: string = "ssh",
  controlPlaneUrl: string = "http://127.0.0.1:7780",
): Promise<void> {
  await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${profileRoot} --profile mini --destination mini --remote-repo-path /srv/common --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime --remote-records-root /var/lib/bucknix/nixos-shared-host/records --ssh-mode ${sshMode} --control-plane-url ${controlPlaneUrl}`;
}

async function installReviewedDeployment(workspaceRoot: string): Promise<string> {
  const deployment = nixosSharedHostDeploymentFixture();
  await installNixosSharedHostTargets(workspaceRoot, [deployment]);
  return deployment.label;
}

test("deploy plan reads the reviewed remote profile deterministically", async () => {
  await runInTemp("nixos-shared-host-remote-plan", async (tmp, $) => {
    const deploymentLabel = await installReviewedDeployment(tmp);
    const profileRoot = `${tmp}/profiles`;
    await installClientProfile($, profileRoot);
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deploymentLabel} --profile mini --profile-root ${profileRoot} --dry-run`;
    assert.deepEqual(JSON.parse(String(result.stdout)), {
      planMode: true,
      remoteExecutionImplemented: true,
      deploymentId: "demoapp-dev",
      deploymentLabel: "//test-workspace/deployments/demoapp-dev:deploy",
      profileName: "mini",
      destination: "mini",
      transportMode: "ssh",
      remoteRepoPath: "/srv/common",
      remoteStatePath: "/var/lib/bucknix/nixos-shared-host/platform-state.json",
      remoteRuntimeRoot: "/var/lib/bucknix/nixos-shared-host/runtime",
      remoteRecordsRoot: "/var/lib/bucknix/nixos-shared-host/records",
      remoteArtifactStageRoot: "/var/lib/bucknix/nixos-shared-host/runtime/.deploy-artifacts",
      serviceClient: {
        mode: "control-plane-service",
        controlPlaneUrl: "http://127.0.0.1:7780",
        controlPlaneTokenEnv: "BNX_DEPLOY_CONTROL_PLANE_TOKEN",
      },
      artifactSource: {
        kind: "component-dist",
        componentTarget: "//test-workspace/apps/demoapp:app",
        outputSubdir: "dist",
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
        remoteManagedRoot: "/etc/nixos/bucknix/nixos-shared-host",
      },
      hostApplyExpectedLater: true,
    });
  });
});

test("deploy plan lets explicit remote overrides win over profile metadata", async () => {
  await runInTemp("nixos-shared-host-remote-plan-overrides", async (tmp, $) => {
    const deploymentLabel = await installReviewedDeployment(tmp);
    const profileRoot = `${tmp}/profiles`;
    const artifactDir = `${tmp}/artifact`;
    await installClientProfile($, profileRoot);
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deploymentLabel} --profile mini --profile-root ${profileRoot} --plan --destination staging-mini --remote-repo-path /srv/staging --remote-state-path /var/lib/staging/state.json --remote-runtime-root /srv/runtime --remote-records-root /srv/records --artifact-dir ${artifactDir}`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.destination, "staging-mini");
    assert.equal(summary.remoteRepoPath, "/srv/staging");
    assert.equal(summary.remoteStatePath, "/var/lib/staging/state.json");
    assert.equal(summary.remoteRuntimeRoot, "/srv/runtime");
    assert.equal(summary.remoteRecordsRoot, "/srv/records");
    assert.deepEqual(summary.artifactSource, {
      kind: "explicit-artifact-dir",
      localArtifactDir: artifactDir,
      remoteTransportRequired: true,
    });
  });
});

test("deploy plan renders reviewed host-apply selection when remote apply is requested", async () => {
  await runInTemp("nixos-shared-host-remote-plan-host-apply", async (tmp, $) => {
    const deploymentLabel = await installReviewedDeployment(tmp);
    const profileRoot = `${tmp}/profiles`;
    await installClientProfile($, profileRoot);
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deploymentLabel} --profile mini --profile-root ${profileRoot} --plan --apply-host --remote-config-root /srv/nixos --remote-managed-root /srv/nixos/bucknix/nixos-shared-host`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /service-only remote profiles do not support/);
  });
});

test("deploy plan keeps host apply explicit and dry-runnable", async () => {
  await runInTemp("nixos-shared-host-remote-plan-host-apply-dry-run", async (tmp, $) => {
    const deploymentLabel = await installReviewedDeployment(tmp);
    const profileRoot = `${tmp}/profiles`;
    await installClientProfile($, profileRoot);
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deploymentLabel} --profile mini --profile-root ${profileRoot} --plan --apply-host-dry-run`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /service-only remote profiles do not support/);
  });
});

test("deploy plan rejects profile mode mixed with local mutation flags", async () => {
  await runInTemp("nixos-shared-host-remote-plan-conflict", async (tmp, $) => {
    const deploymentLabel = await installReviewedDeployment(tmp);
    const profileRoot = `${tmp}/profiles`;
    await installClientProfile($, profileRoot);
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deploymentLabel} --profile mini --profile-root ${profileRoot} --plan --state /tmp/platform-state.json`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /--profile cannot be combined with local execution flags/);
    assert.match(String(result.stderr), /--state/);
  });
});

test("deploy plan rejects local control-plane service flags in remote profile mode", async () => {
  await runInTemp("nixos-shared-host-remote-plan-control-plane-conflict", async (tmp, $) => {
    const deploymentLabel = await installReviewedDeployment(tmp);
    const profileRoot = `${tmp}/profiles`;
    await installClientProfile($, profileRoot);
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deploymentLabel} --profile mini --profile-root ${profileRoot} --plan --control-plane-url http://127.0.0.1:7780`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /--profile cannot be combined with local execution flags/);
    assert.match(String(result.stderr), /--control-plane-url/);
  });
});

test("deploy plan rejects host-apply path overrides unless host apply is selected", async () => {
  await runInTemp("nixos-shared-host-remote-plan-host-apply-overrides", async (tmp, $) => {
    const deploymentLabel = await installReviewedDeployment(tmp);
    const profileRoot = `${tmp}/profiles`;
    await installClientProfile($, profileRoot);
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deploymentLabel} --profile mini --profile-root ${profileRoot} --plan --remote-config-root /srv/nixos`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /service-only remote profiles do not support/);
  });
});

test("deploy plan fails closed when the requested profile is missing", async () => {
  await runInTemp("nixos-shared-host-remote-plan-missing-profile", async (tmp, $) => {
    const deploymentLabel = await installReviewedDeployment(tmp);
    const profileRoot = `${tmp}/profiles`;
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deploymentLabel} --profile mini --profile-root ${profileRoot} --plan`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /missing reviewed remote profile "mini"/);
  });
});

test("deploy plan fails closed on malformed client manifests", async () => {
  await runInTemp("nixos-shared-host-remote-plan-malformed-profile", async (tmp, $) => {
    const deploymentLabel = await installReviewedDeployment(tmp);
    const profileRoot = `${tmp}/profiles`;
    const miniProfilePath = `${profileRoot}/mini.json`;
    await fsp.mkdir(profileRoot, { recursive: true });
    await fsp.writeFile(
      miniProfilePath,
      JSON.stringify({
        schemaVersion: "nixos-shared-host-client@1",
        tool: "nixos-shared-host-install",
        toolFingerprint: "broken",
        profileName: "mini",
        destination: "mini",
        remoteRepoPath: "/srv/common",
        remoteStatePath: "/var/lib/bucknix/nixos-shared-host/platform-state.json",
        remoteRuntimeRoot: "/var/lib/bucknix/nixos-shared-host/runtime",
        remoteRecordsRoot: "/var/lib/bucknix/nixos-shared-host/records",
        sshMode: "ssh",
        localManagedPaths: [],
      }),
      "utf8",
    );
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deploymentLabel} --profile mini --profile-root ${profileRoot} --plan`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /invalid nixos-shared-host client manifest/);
  });
});

test("deploy plan fails closed on unsupported reviewed transport modes", async () => {
  await runInTemp("nixos-shared-host-remote-plan-transport", async (tmp, $) => {
    const deploymentLabel = await installReviewedDeployment(tmp);
    const profileRoot = `${tmp}/profiles`;
    await installClientProfile($, profileRoot, "local");
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deploymentLabel} --profile mini --profile-root ${profileRoot} --plan`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /unsupported reviewed transport mode "local"/);
  });
});
