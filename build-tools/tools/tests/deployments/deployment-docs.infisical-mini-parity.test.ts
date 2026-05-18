#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/cloudflare-pages-control-plane-api-contract";
import { resolveReviewedControlPlaneServiceInstance } from "../../deployments/deployment-control-plane-service-identity";
import { withWorkerDeploymentSecretRuntime } from "../../deployments/deployment-secret-runtime-worker";
import { workerSecretRuntimeMetadata } from "../../deployments/deployment-secret-worker-runtime-metadata";
import {
  createClientManifest,
  parseClientManifest,
} from "../../deployments/nixos-shared-host-client-manifest";
import {
  NIXOS_SHARED_HOST_CLIENT_SCHEMA_V1,
  NIXOS_SHARED_HOST_INSTALL_TOOL,
} from "../../deployments/nixos-shared-host-install-contract";
import { maybePromptClientInstallInput } from "../../deployments/nixos-shared-host-install-prompt";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { infisicalRequirement, infisicalRuntime } from "./deployment-secret-infisical.fixture";

const repoRoot = process.cwd();
const oldControlPlaneTokenEnv = ["B", "NX_DEPLOY_CONTROL_PLANE_TOKEN"].join("");
const currentControlPlaneTokenEnv = "VBR_DEPLOY_CONTROL_PLANE_TOKEN";
const oldRemoteRepoPath = ["/srv", "common"].join("/");

async function readDoc(name: string): Promise<string> {
  return await fsp.readFile(path.join(repoRoot, "docs", name), "utf8");
}

test("mini migration docs cover Infisical worker secret boundary", async () => {
  const [nixosUsage, miniMigration, secretsApi] = await Promise.all([
    readDoc("nixos-shared-host-usage.md"),
    readDoc("mini-name-migration-instructions.md"),
    readDoc("deployment-secrets-api.md"),
  ]);
  for (const fragment of [
    /Mini Pre-`viberoots` Infisical Migration/,
    /docs\/mini-name-migration-instructions\.md/,
    /secret_backend = "infisical\/default"/,
    /pre-`viberoots` control-plane identity/,
    /server-local Infisical credential references/,
    /--profile mini/,
  ]) {
    assert.match(
      nixosUsage,
      fragment,
      `nixos shared host usage must cover mini Infisical migration detail ${String(fragment)}`,
    );
  }
  for (const fragment of [
    /\/srv\/common[\s\S]*\/srv\/viberoots/,
    /git@github\.com:kiltyj\/common\.git[\s\S]*git@github\.com:viberoots\/viberoots\.git/,
    new RegExp(`${oldControlPlaneTokenEnv}[\\s\\S]*${currentControlPlaneTokenEnv}`),
    /Infisical-backed deployment readiness/,
    /VBR_MINI_INFISICAL_CLIENT_ID/,
    /VBR_MINI_INFISICAL_CLIENT_SECRET/,
    /infisicalRuntime[\s\S]*Universal Auth client secret/,
    /service identity is the current `viberoots` service\s+path/,
  ]) {
    assert.match(
      miniMigration,
      fragment,
      `mini migration runbook must cover pre-viberoots Infisical upgrade detail ${String(fragment)}`,
    );
  }
  assert.match(
    secretsApi,
    /createDeploymentSecretRuntimeForAdmittedContext\(\)[\s\S]*Infisical adapter directly/,
    "deployment and secrets API doc must keep provider code on the neutral runtime boundary",
  );
});

test("mini migration contract preserves service metadata and enables Infisical worker wiring", async () => {
  const preRenameManifest = parseClientManifest(
    {
      schemaVersion: NIXOS_SHARED_HOST_CLIENT_SCHEMA_V1,
      tool: NIXOS_SHARED_HOST_INSTALL_TOOL,
      toolFingerprint: "pre-viberoots-tool",
      profileName: "mini",
      destination: "root@mini.home.kilty.io",
      remoteRepoPath: oldRemoteRepoPath,
      remoteStatePath: "/etc/nixos/deployment-host/platform-state.json",
      remoteRuntimeRoot: "/var/lib/deployment-host/runtime",
      remoteRecordsRoot: "/var/lib/deployment-host/records",
      sshMode: "ssh",
      serviceClient: {
        controlPlaneUrl: "https://deploy.apps.kilty.io",
        controlPlaneTokenEnv: oldControlPlaneTokenEnv,
      },
      localManagedPaths: [".local/deployments/nixos-shared-host/clients/mini.json"],
    },
    "pre-rename-mini.json",
  );
  assert.equal(preRenameManifest.remoteRepoPath, oldRemoteRepoPath);
  assert.equal(preRenameManifest.serviceClient.controlPlaneTokenEnv, oldControlPlaneTokenEnv);

  const migratedInput = await maybePromptClientInstallInput(
    repoRoot,
    {
      profileName: preRenameManifest.profileName,
      destination: preRenameManifest.destination,
      controlPlaneUrl: preRenameManifest.serviceClient.controlPlaneUrl,
      sshMode: preRenameManifest.sshMode,
    },
    { interactive: false },
  );
  const migratedManifest = createClientManifest({
    profileName: migratedInput.profileName || "",
    destination: migratedInput.destination || "",
    remoteRepoPath: migratedInput.remoteRepoPath || "",
    remoteStatePath: migratedInput.remoteStatePath || "",
    remoteRuntimeRoot: migratedInput.remoteRuntimeRoot || "",
    remoteRecordsRoot: migratedInput.remoteRecordsRoot || "",
    sshMode: migratedInput.sshMode || "",
    controlPlaneUrl: migratedInput.controlPlaneUrl || "",
    controlPlaneTokenEnv: migratedInput.controlPlaneTokenEnv,
    toolFingerprint: "post-viberoots-tool",
  }).manifest;
  assert.equal(migratedManifest.profileName, "mini");
  assert.equal(migratedManifest.remoteRepoPath, "/srv/viberoots");
  assert.equal(migratedManifest.serviceClient.controlPlaneTokenEnv, currentControlPlaneTokenEnv);

  const deployment = {
    ...cloudflarePagesDeploymentFixture({ secretRequirements: [infisicalRequirement] }),
    secretBackend: "infisical" as const,
    infisicalRuntime: {
      ...infisicalRuntime,
      siteUrl: "https://infisical.example.test",
      preferredCredentialSource: "machine_identity_universal_auth" as const,
      machineIdentityClientIdEnv: "VBR_MINI_INFISICAL_CLIENT_ID",
      machineIdentityClientSecretEnv: "VBR_MINI_INFISICAL_CLIENT_SECRET",
    },
  };
  const serviceInstance = await resolveReviewedControlPlaneServiceInstance({
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
    workspaceRoot: repoRoot,
    deployment,
  });
  assert.equal(serviceInstance?.reviewedRepository, "viberoots/viberoots");
  assert.equal(serviceInstance?.reviewedRef, "main");

  const snapshotMetadata = workerSecretRuntimeMetadata({ deployment });
  assert.equal("vaultRuntime" in snapshotMetadata, false);
  assert.equal(snapshotMetadata.infisicalRuntime?.siteUrl, "https://infisical.example.test");
  assert.equal(
    snapshotMetadata.infisicalRuntime?.machineIdentityClientSecretEnv,
    "VBR_MINI_INFISICAL_CLIENT_SECRET",
  );

  let capturedSecret = "";
  await withWorkerDeploymentSecretRuntime(
    {
      workspaceRoot: repoRoot,
      deployment,
      env: {
        VBR_MINI_INFISICAL_CLIENT_ID: "mini-worker",
        VBR_MINI_INFISICAL_CLIENT_SECRET: "server-local-secret",
      },
    },
    async (runtime) => {
      assert.equal(runtime.secretContext?.kind, "infisical");
      if (runtime.secretContext?.kind === "infisical") {
        assert.equal(runtime.secretContext.credential.kind, "universal_auth");
        capturedSecret = runtime.secretContext.credential.clientSecret;
      }
    },
  );
  assert.equal(capturedSecret, "server-local-secret");
});
