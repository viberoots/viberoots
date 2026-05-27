#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { evalModule } from "./control-plane-nixos-container-module.helpers";

const githubAppCredentials = `
  credentials = {
    control-plane-database-url.source = "/run/secrets/db";
    control-plane-token.source = "/run/secrets/control-plane-token";
    reviewed-source-github-app-id.source = "/run/secrets/github-app-id";
    reviewed-source-github-app-installation-id.source = "/run/secrets/github-installation-id";
    reviewed-source-github-app-private-key.source = "/run/secrets/github-private-key";
    cloud-control-fixture-staging-infisical-client-id.source = "/run/secrets/infisical-id";
    cloud-control-fixture-staging-infisical-client-secret.source = "/run/secrets/infisical-secret";
    artifact-store-endpoint.source = "/run/secrets/endpoint";
    artifact-store-access-key-id.source = "/run/secrets/access";
    artifact-store-secret-access-key.source = "/run/secrets/secret";
  };
`;

test("control-plane NixOS container module renders GitHub App reviewed-source config", async () => {
  await runInTemp("control-plane-nixos-container-github-app", async (tmp, $) => {
    const out = await evalModule(
      tmp,
      $,
      `reviewedSourceMode = "github-app";`,
      `{
      serviceLoadCredential =
        system.config.systemd.services.podman-deployment-control-plane-service.serviceConfig.LoadCredential;
      configText = system.config.environment.etc."deployment-control-plane/config.yaml".text;
    }`,
      { credentials: githubAppCredentials },
    );
    const rendered = JSON.parse(String(out.configText));
    assert.equal(rendered.reviewedSource.mode, "github-app");
    assert.equal(
      rendered.reviewedSource.githubAppPrivateKeyFile,
      "/run/deployment-control-plane/credentials/reviewed-source-github-app-private-key",
    );
    assert.ok(
      (out.serviceLoadCredential as string[]).includes(
        "reviewed-source-github-app-private-key:/run/secrets/github-private-key",
      ),
    );
    assert.ok(
      !(out.serviceLoadCredential as string[]).some((item) =>
        item.startsWith("reviewed-source-ssh-key:"),
      ),
    );
  });
});
