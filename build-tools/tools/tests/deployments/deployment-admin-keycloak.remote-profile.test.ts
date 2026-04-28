#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { reviewedHumanGroupName } from "../../deployments/deployment-auth-groups";
import {
  anchorPathFor,
  createEmptyPlatformStateJson,
  createInstallManifestV1,
  manifestPathFor,
  modulePathFor,
  renderManagedAnchor,
  renderManagedModule,
} from "../../deployments/nixos-shared-host-install-contract";
import {
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";
import { runInTemp } from "../lib/test-helpers";
import {
  pleominoDeploymentFixture,
  prepareRemoteExecFixture,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers";

function shapeAdminGroup() {
  return "deploy-admin-identity-shape-admin-project-pleomino";
}

function membershipAdminGroup() {
  return "deploy-admin-identity-membership-admin-project-pleomino";
}

function realmFileFor(configRoot: string) {
  return path.join(
    configRoot,
    "deployment-host",
    "identity-provider",
    "deployment-auth-realm.json",
  );
}

function membershipFileFor(configRoot: string) {
  return path.join(
    configRoot,
    "deployment-host",
    "identity-provider",
    "deployment-auth-memberships.json",
  );
}

test("deploy admin identity remote profile reuses one reviewed temp repo across contract checks", async () => {
  await runInTemp("deploy-admin-keycloak-remote-profile", async (tmp, $) => {
    const { env, profileRoot, remoteRecordsRoot, remoteRuntimeRoot, remoteStatePath } =
      await prepareRemoteExecFixture({
        tmp,
        $,
        artifactFiles: { "index.html": "<html>ok</html>\n" },
      });
    const baseEnv = remoteExecEnv(env);

    const syncConfigRoot = path.join(tmp, "remote-config-root-sync");
    const syncResult = await $({
      cwd: tmp,
      env: baseEnv,
    })`zx-wrapper build-tools/tools/deployments/deploy.ts admin identity sync --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --remote-config-root ${syncConfigRoot} --acting-principal user:shape-admin --admin-group ${shapeAdminGroup()}`;
    const syncSummary = JSON.parse(String(syncResult.stdout));
    assert.equal(syncSummary.executionMode, "remote-profile");
    assert.equal(
      syncSummary.remoteArtifacts.configRelativeRealmFile,
      "./deployment-host/identity-provider/deployment-auth-realm.json",
    );
    assert.equal(syncSummary.remoteArtifacts.realmFile, realmFileFor(syncConfigRoot));
    assert.equal(syncSummary.hostApply.requestedMode, "skip");
    assert.equal(syncSummary.mutation.audit.requestedMutation.remoteProfile, "mini");
    assert.match(
      await fsp.readFile(realmFileFor(syncConfigRoot), "utf8"),
      /deploy-submitters-pleomino-dev/,
    );

    const authzConfigRoot = path.join(tmp, "remote-config-root-authz");
    const authzResult = await $({
      cwd: tmp,
      env: baseEnv,
    })`zx-wrapper build-tools/tools/deployments/deploy.ts admin identity sync --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --remote-config-root ${authzConfigRoot} --acting-principal user:submitter-only --admin-group ${reviewedHumanGroupName(pleominoDeploymentFixture(), "submitter")}`.nothrow();
    assert.notEqual(authzResult.exitCode, 0);
    assert.match(
      String(authzResult.stderr),
      /lacks reviewed identity group-shape admin|ask an authorized operator to run: deploy admin identity sync/i,
    );

    const hostApplyConfigRoot = path.join(tmp, "remote-config-root-host-apply");
    const managedRoot = path.join(hostApplyConfigRoot, "deployment-host");
    const configEntryPath = path.join(hostApplyConfigRoot, "configuration.nix");
    const configEntrySource = [
      "{ ... }:",
      "{",
      "  imports = [",
      "    ./deployment-host/default.nix",
      "  ];",
      "}",
      "",
    ].join("\n");
    const rebuildLog = path.join(tmp, "nixos-rebuild.log");
    await fsp.mkdir(managedRoot, { recursive: true });
    await Promise.all([
      fsp.writeFile(configEntryPath, configEntrySource, "utf8"),
      fsp.writeFile(remoteStatePath, createEmptyPlatformStateJson(), "utf8"),
      fsp.writeFile(
        manifestPathFor(managedRoot),
        JSON.stringify(
          createInstallManifestV1({
            toolFingerprint: "test",
            installMode: "managed-dropin",
            configTopology: "plain",
            configRoot: hostApplyConfigRoot,
            configEntryPath,
            configInjected: true,
            managedRoot,
            statePath: remoteStatePath,
            runtimeRoot: remoteRuntimeRoot,
            recordsRoot: remoteRecordsRoot,
          }),
          null,
          2,
        ) + "\n",
        "utf8",
      ),
      fsp.writeFile(
        modulePathFor(managedRoot),
        renderManagedModule({ managedRoot, statePath: remoteStatePath }),
        "utf8",
      ),
      fsp.writeFile(anchorPathFor(managedRoot), renderManagedAnchor(managedRoot), "utf8"),
    ]);
    const hostApplyResult = await $({
      cwd: tmp,
      env: remoteExecEnv(env, { FAKE_NIXOS_REBUILD_LOG: rebuildLog }),
    })`zx-wrapper build-tools/tools/deployments/deploy.ts admin identity grant-user --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --remote-config-root ${hostApplyConfigRoot} --apply-host-dry-run --action submit --user-email alice@example.com --acting-principal user:membership-admin --admin-group ${membershipAdminGroup()}`;
    const hostApplySummary = JSON.parse(String(hostApplyResult.stdout));
    assert.equal(hostApplySummary.hostApply.requestedMode, "dry-run");
    assert.equal(hostApplySummary.hostApply.result.mode, "dry-run");
    assert.match(await fsp.readFile(rebuildLog, "utf8"), /dry-activate/);
    assert.match(
      await fsp.readFile(membershipFileFor(hostApplyConfigRoot), "utf8"),
      /alice@example\.com/,
    );

    const providerDeployment = cloudflarePagesDeploymentFixture();
    await installCloudflarePagesTargets(tmp, [providerDeployment]);
    const providerResult = await $({
      cwd: tmp,
      env: baseEnv,
    })`zx-wrapper build-tools/tools/deployments/deploy.ts admin identity sync --deployment ${providerDeployment.label} --profile mini --acting-principal user:shape-admin --admin-group ${shapeAdminGroup()}`.nothrow();
    assert.notEqual(providerResult.exitCode, 0);
    assert.match(
      String(providerResult.stderr),
      /supported only for reviewed nixos-shared-host deployments/i,
    );
  });
});
