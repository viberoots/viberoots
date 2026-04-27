#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { reviewedHumanGroupName } from "../../deployments/deployment-auth-groups.ts";
import {
  anchorPathFor,
  createEmptyPlatformStateJson,
  createInstallManifestV1,
  manifestPathFor,
  modulePathFor,
  renderManagedAnchor,
  renderManagedModule,
} from "../../deployments/nixos-shared-host-install-contract.ts";
import {
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  pleominoDeploymentFixture,
  prepareRemoteExecFixture,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers.ts";

function shapeAdminGroup() {
  return "deploy-admin-identity-shape-admin-project-pleomino";
}

function membershipAdminGroup() {
  return "deploy-admin-identity-membership-admin-project-pleomino";
}

function configRootFor(tmp: string) {
  return path.join(tmp, "remote-config-root");
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

test("deploy admin identity sync writes reviewed remote artifacts under the config root", async () => {
  await runInTemp("deploy-admin-keycloak-remote-sync", async (tmp, $) => {
    const { env, profileRoot } = await prepareRemoteExecFixture({
      tmp,
      $,
      artifactFiles: { "index.html": "<html>ok</html>\n" },
    });
    const configRoot = configRootFor(tmp);
    const result = await $({
      cwd: tmp,
      env: remoteExecEnv(env),
    })`zx-wrapper build-tools/tools/deployments/deploy.ts admin identity sync --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --remote-config-root ${configRoot} --acting-principal user:shape-admin --admin-group ${shapeAdminGroup()}`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.executionMode, "remote-profile");
    assert.equal(
      summary.remoteArtifacts.configRelativeRealmFile,
      "./deployment-host/identity-provider/deployment-auth-realm.json",
    );
    assert.equal(summary.remoteArtifacts.realmFile, realmFileFor(configRoot));
    assert.equal(summary.hostApply.requestedMode, "skip");
    assert.equal(summary.mutation.audit.requestedMutation.remoteProfile, "mini");
    assert.match(
      await fsp.readFile(realmFileFor(configRoot), "utf8"),
      /deploy-submitters-pleomino-dev/,
    );
  });
});

test("deploy admin identity remote profile still enforces separate admin grants", async () => {
  await runInTemp("deploy-admin-keycloak-remote-authz", async (tmp, $) => {
    const { env, profileRoot } = await prepareRemoteExecFixture({
      tmp,
      $,
      artifactFiles: { "index.html": "<html>ok</html>\n" },
    });
    const configRoot = configRootFor(tmp);
    const result = await $({
      cwd: tmp,
      env: remoteExecEnv(env),
    })`zx-wrapper build-tools/tools/deployments/deploy.ts admin identity sync --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --remote-config-root ${configRoot} --acting-principal user:submitter-only --admin-group ${reviewedHumanGroupName(pleominoDeploymentFixture(), "submitter")}`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(
      String(result.stderr),
      /lacks reviewed identity group-shape admin|ask an authorized operator to run: deploy admin identity sync/i,
    );
  });
});

test("deploy admin identity remote profile rejects unsupported deployment providers", async () => {
  await runInTemp("deploy-admin-keycloak-remote-provider", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    await installCloudflarePagesTargets(tmp, [deployment]);
    const result = await $({
      cwd: tmp,
      env: remoteExecEnv(process.env as Record<string, string>),
    })`zx-wrapper build-tools/tools/deployments/deploy.ts admin identity sync --deployment ${deployment.label} --profile mini --acting-principal user:shape-admin --admin-group ${shapeAdminGroup()}`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(
      String(result.stderr),
      /supported only for reviewed nixos-shared-host deployments/i,
    );
  });
});

test("deploy admin identity remote profile reuses reviewed host-apply dry-run", async () => {
  await runInTemp("deploy-admin-keycloak-remote-host-apply", async (tmp, $) => {
    const { env, profileRoot, remoteRecordsRoot, remoteRuntimeRoot, remoteStatePath } =
      await prepareRemoteExecFixture({
        tmp,
        $,
        artifactFiles: { "index.html": "<html>ok</html>\n" },
      });
    const configRoot = configRootFor(tmp);
    const managedRoot = path.join(configRoot, "deployment-host");
    const configEntryPath = path.join(configRoot, "configuration.nix");
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
            configRoot,
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
    const result = await $({
      cwd: tmp,
      env: remoteExecEnv(env, { FAKE_NIXOS_REBUILD_LOG: rebuildLog }),
    })`zx-wrapper build-tools/tools/deployments/deploy.ts admin identity grant-user --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${profileRoot} --remote-config-root ${configRoot} --apply-host-dry-run --action submit --user-email alice@example.com --acting-principal user:membership-admin --admin-group ${membershipAdminGroup()}`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.hostApply.requestedMode, "dry-run");
    assert.equal(summary.hostApply.result.mode, "dry-run");
    assert.match(await fsp.readFile(rebuildLog, "utf8"), /dry-activate/);
    assert.match(await fsp.readFile(membershipFileFor(configRoot), "utf8"), /alice@example\.com/);
  });
});
