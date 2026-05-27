#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { evalModule, REVIEWED_IMAGE_DIGEST } from "./control-plane-nixos-container-module.helpers";

const miniProfileImport = "./build-tools/tools/nix/deployment-control-plane-mini-cloud-profile.nix";
const profileCredentials = `
          control-plane-database-url.source = "/run/secrets/db";
          control-plane-token.source = "/run/secrets/control-plane-token";
          reviewed-source-ssh-key.source = "/run/secrets/ssh";
          reviewed-source-known-hosts.source = "/run/secrets/known-hosts";
          cloud-control-fixture-staging-infisical-client-id.source = "/run/secrets/infisical-id";
          cloud-control-fixture-staging-infisical-client-secret.source = "/run/secrets/infisical-secret";
          artifact-store-endpoint.source = "/run/secrets/endpoint";
          artifact-store-access-key-id.source = "/run/secrets/access";
          artifact-store-secret-access-key.source = "/run/secrets/secret";
`;

test("mini cloud profile renders external Postgres and S3 container shape", async () => {
  await runInTemp("control-plane-mini-cloud-profile", async (tmp, $) => {
    const out = await evalModule(
      tmp,
      $,
      "",
      `{
      profile = system.config.services.viberoots.miniCloudControlPlaneProfile;
      container = system.config.services.viberoots.deploymentControlPlaneContainer;
      rendered = builtins.fromJSON system.config.environment.etc."deployment-control-plane/config.yaml".text;
      servicePreStart = system.config.systemd.services.podman-deployment-control-plane-service.preStart;
    }`,
      {
        imports: [miniProfileImport],
        extraConfig: `
      services.viberoots.miniCloudControlPlaneProfile = {
        enable = true;
        image = "registry.example.com/platform/control-plane@${REVIEWED_IMAGE_DIGEST}";
        publicUrl = "https://mini.example.test";
        publicHostName = "mini.example.test";
        artifactBucket = "mini-control-plane-artifacts";
        credentials = {
${profileCredentials}
        };
      };
    `,
      },
    );
    const profile = out.profile as Record<string, unknown>;
    const container = out.container as Record<string, any>;
    assert.equal(profile.enable, true);
    assert.equal(container.instanceId, "mini");
    assert.equal(container.manageNginx, true);
    assert.equal(container.miniMigrationPreflight.enable, true);
    assert.equal(container.artifactStore.bucket, "mini-control-plane-artifacts");
    assert.equal(container.recordsRoot, "/var/lib/deployment-control-plane/external-record-cache");
    assert.match(
      String(out.servicePreStart),
      /\$CREDENTIALS_DIRECTORY\/control-plane-database-url/,
    );
    assert.doesNotMatch(String(out.servicePreStart), /\/run\/secrets\/db"\s+"\$dst/);
    assert.equal(
      (out.rendered as any).storage.artifactStore.bucket,
      "mini-control-plane-artifacts",
    );
    assert.equal((out.rendered as any).miniMigrationPreflight.enabled, true);
  });
});

test("mini cloud profile rejects incomplete external persistence config", async () => {
  await runInTemp("control-plane-mini-cloud-profile-assertions", async (tmp, $) => {
    const out = await evalModule(
      tmp,
      $,
      "",
      `{
      failedAssertions = map (item: item.message) (
        builtins.filter
          (item: !item.assertion && lib.hasPrefix "miniCloudControlPlaneProfile" item.message)
          system.config.assertions
      );
    }`,
      {
        image: false,
        bucket: false,
        imports: [miniProfileImport],
        extraConfig: `
      services.viberoots.miniCloudControlPlaneProfile = {
        enable = true;
        publicUrl = null;
        artifactBucket = null;
        credentials = {
${profileCredentials}
        };
      };
    `,
      },
    );
    assert.deepEqual(out.failedAssertions, [
      "miniCloudControlPlaneProfile.image is required.",
      "miniCloudControlPlaneProfile.publicUrl is required.",
      "miniCloudControlPlaneProfile.artifactBucket is required.",
    ]);
  });
});
