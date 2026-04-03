#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

async function writeDeploymentJson(tmp: string): Promise<string> {
  const deploymentJson = path.join(tmp, "deployment.json");
  await fsp.writeFile(
    deploymentJson,
    JSON.stringify(nixosSharedHostDeploymentFixture(), null, 2) + "\n",
    "utf8",
  );
  return deploymentJson;
}

async function installClientProfile(
  $: any,
  profileRoot: string,
  sshMode: string = "ssh",
): Promise<void> {
  await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${profileRoot} --profile mini --destination mini --remote-repo-path /srv/common --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime --remote-records-root /var/lib/bucknix/nixos-shared-host/records --ssh-mode ${sshMode}`;
}

test("deploy plan reads the reviewed remote profile deterministically", async () => {
  await runInTemp("nixos-shared-host-remote-plan", async (tmp, $) => {
    const deploymentJson = await writeDeploymentJson(tmp);
    const profileRoot = path.join(tmp, "profiles");
    await installClientProfile($, profileRoot);
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --profile mini --profile-root ${profileRoot} --dry-run`;
    assert.deepEqual(JSON.parse(String(result.stdout)), {
      planMode: true,
      remoteExecutionImplemented: true,
      deploymentId: "demoapp-dev",
      deploymentLabel: "//projects/deployments/demoapp-dev:deploy",
      profileName: "mini",
      destination: "mini",
      transportMode: "ssh",
      remoteRepoPath: "/srv/common",
      remoteStatePath: "/var/lib/bucknix/nixos-shared-host/platform-state.json",
      remoteRuntimeRoot: "/var/lib/bucknix/nixos-shared-host/runtime",
      remoteRecordsRoot: "/var/lib/bucknix/nixos-shared-host/records",
      remoteArtifactStageRoot: "/var/lib/bucknix/nixos-shared-host/runtime/.deploy-artifacts",
      artifactSource: {
        kind: "component-dist",
        componentTarget: "//projects/apps/demoapp:app",
        outputSubdir: "dist",
        remoteTransportRequired: true,
      },
      stagedArtifactCleanup: {
        defaultMode: "remove",
        retainFlag: "--retain-remote-artifact",
      },
      hostApplyExpectedLater: true,
    });
  });
});

test("deploy plan lets explicit remote overrides win over profile metadata", async () => {
  await runInTemp("nixos-shared-host-remote-plan-overrides", async (tmp, $) => {
    const deploymentJson = await writeDeploymentJson(tmp);
    const profileRoot = path.join(tmp, "profiles");
    const artifactDir = path.join(tmp, "artifact");
    await installClientProfile($, profileRoot);
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --profile mini --profile-root ${profileRoot} --plan --destination staging-mini --remote-repo-path /srv/staging --remote-state-path /var/lib/staging/state.json --remote-runtime-root /srv/runtime --remote-records-root /srv/records --artifact-dir ${artifactDir}`;
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

test("deploy plan rejects profile mode mixed with local mutation flags", async () => {
  await runInTemp("nixos-shared-host-remote-plan-conflict", async (tmp, $) => {
    const deploymentJson = await writeDeploymentJson(tmp);
    const profileRoot = path.join(tmp, "profiles");
    await installClientProfile($, profileRoot);
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --profile mini --profile-root ${profileRoot} --plan --state /tmp/platform-state.json`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /--profile cannot be combined with local execution flags/);
    assert.match(String(result.stderr), /--state/);
  });
});

test("deploy plan fails closed when the requested profile is missing", async () => {
  await runInTemp("nixos-shared-host-remote-plan-missing-profile", async (tmp, $) => {
    const deploymentJson = await writeDeploymentJson(tmp);
    const profileRoot = path.join(tmp, "profiles");
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --profile mini --profile-root ${profileRoot} --plan`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /missing reviewed remote profile "mini"/);
  });
});

test("deploy plan fails closed on malformed client manifests", async () => {
  await runInTemp("nixos-shared-host-remote-plan-malformed-profile", async (tmp, $) => {
    const deploymentJson = await writeDeploymentJson(tmp);
    const profileRoot = path.join(tmp, "profiles");
    await fsp.mkdir(profileRoot, { recursive: true });
    await fsp.writeFile(
      path.join(profileRoot, "mini.json"),
      JSON.stringify({
        schemaVersion: "nixos-shared-host-client@1",
        tool: "nixos-shared-host-install",
        toolFingerprint: "broken",
        profileName: "mini",
        destination: "mini",
        localManagedPaths: [],
      }),
      "utf8",
    );
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --profile mini --profile-root ${profileRoot} --plan`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /invalid nixos-shared-host client manifest/);
  });
});

test("deploy plan fails closed on unsupported reviewed transport modes", async () => {
  await runInTemp("nixos-shared-host-remote-plan-transport", async (tmp, $) => {
    const deploymentJson = await writeDeploymentJson(tmp);
    const profileRoot = path.join(tmp, "profiles");
    await installClientProfile($, profileRoot, "local");
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --profile mini --profile-root ${profileRoot} --plan`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /unsupported reviewed transport mode "local"/);
  });
});
