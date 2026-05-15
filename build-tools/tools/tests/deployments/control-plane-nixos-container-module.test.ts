#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

type EvalOut = Record<string, unknown>;

const credentialConfig = `
  credentials = {
    control-plane-database-url.source = "/run/secrets/db";
    reviewed-source-ssh-key.source = "/run/secrets/ssh";
    artifact-store-endpoint.source = "/run/secrets/endpoint";
    artifact-store-access-key-id.source = "/run/secrets/access";
    artifact-store-secret-access-key.source = "/run/secrets/secret";
  };
`;

async function evalModule(
  tmp: string,
  $: any,
  moduleConfig: string,
  body: string,
  base: { image?: boolean; bucket?: boolean; credentials?: string } = {},
): Promise<EvalOut> {
  const includeImage = base.image ?? true;
  const includeBucket = base.bucket ?? true;
  const credentials = base.credentials ?? credentialConfig;
  const expr = `
    let
      lib = import <nixpkgs/lib>;
      system = import <nixpkgs/nixos> {
        configuration = {
          nixpkgs.hostPlatform = "x86_64-linux";
          imports = [ ./build-tools/tools/nix/deployment-control-plane-container-module.nix ];
          system.stateVersion = "24.11";
          services.viberoots.deploymentControlPlaneContainer = {
            enable = true;
            instanceId = "mini";
            publicUrl = "https://deploy.example.test";
            ${includeBucket ? `artifactStore.bucket = "deployment-artifacts";` : ""}
            ${
              includeImage
                ? `image = "registry.example.com/platform/deployment-control-plane@sha256:reviewed";`
                : ""
            }
            ${credentials}
            ${moduleConfig}
          };
        };
      };
    in ${body}
  `;
  const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
  return JSON.parse(String(stdout || "{}")) as EvalOut;
}

test("control-plane NixOS container module defaults to Podman service plus two workers", async () => {
  await runInTemp("control-plane-nixos-container-defaults", async (tmp, $) => {
    const out = await evalModule(
      tmp,
      $,
      "",
      `{
      backend = system.config.virtualisation.oci-containers.backend;
      containers = builtins.attrNames system.config.virtualisation.oci-containers.containers;
      service = system.config.virtualisation.oci-containers.containers.deployment-control-plane-service;
      configText = system.config.environment.etc."deployment-control-plane/config.yaml".text;
      tmpfiles = system.config.systemd.tmpfiles.rules;
    }`,
    );
    assert.equal(out.backend, "podman");
    assert.deepEqual(out.containers, [
      "deployment-control-plane-service",
      "deployment-control-plane-worker-1",
      "deployment-control-plane-worker-2",
    ]);
    const service = out.service as {
      cmd: string[];
      extraOptions: string[];
      ports: string[];
      volumes: string[];
    };
    assert.deepEqual(service.cmd, [
      "deployment-control-plane",
      "service",
      "--config",
      "/etc/deployment-control-plane/config.yaml",
    ]);
    assert.deepEqual(service.ports, ["127.0.0.1:7780:7780"]);
    assert.ok(service.extraOptions.some((option) => option.startsWith("--health-cmd=")));
    assert.ok(
      service.volumes.includes(
        "/run/secrets/db:/run/deployment-control-plane/credentials/control-plane-database-url:ro",
      ),
    );
    const rendered = JSON.parse(String(out.configText));
    assert.equal(rendered.instanceId, "mini");
    assert.equal(rendered.storage.artifactStore.bucket, "deployment-artifacts");
    assert.equal(rendered.webUi.enabled, true);
    assert.ok(
      (out.tmpfiles as string[]).includes(
        "d /var/lib/deployment-control-plane/records 0750 deployment-control-plane deployment-control-plane -",
      ),
    );
  });
});

test("control-plane NixOS container module preserves mounts when Docker is selected", async () => {
  await runInTemp("control-plane-nixos-container-docker", async (tmp, $) => {
    const out = await evalModule(
      tmp,
      $,
      `containerRuntime = "docker"; workerReplicas = 1;`,
      `{
      backend = system.config.virtualisation.oci-containers.backend;
      containers = builtins.attrNames system.config.virtualisation.oci-containers.containers;
      serviceLoadCredential =
        system.config.systemd.services.docker-deployment-control-plane-service.serviceConfig.LoadCredential;
      workerLoadCredential =
        system.config.systemd.services.docker-deployment-control-plane-worker-1.serviceConfig.LoadCredential;
      service = system.config.virtualisation.oci-containers.containers.deployment-control-plane-service;
      worker = system.config.virtualisation.oci-containers.containers.deployment-control-plane-worker-1;
    }`,
    );
    assert.equal(out.backend, "docker");
    assert.deepEqual(out.containers, [
      "deployment-control-plane-service",
      "deployment-control-plane-worker-1",
    ]);
    assert.deepEqual(out.serviceLoadCredential, out.workerLoadCredential);
    assert.ok(
      (out.serviceLoadCredential as string[]).includes(
        "control-plane-database-url:/run/secrets/db",
      ),
    );
    const service = out.service as { extraOptions: string[]; ports: string[] };
    assert.deepEqual(service.ports, ["127.0.0.1:7780:7780"]);
    assert.ok(service.extraOptions.includes("--health-interval=30s"));
    const worker = out.worker as { cmd: string[]; volumes: string[] };
    assert.deepEqual(worker.cmd.slice(0, 2), ["deployment-control-plane", "worker"]);
    assert.ok(
      worker.volumes.includes(
        "/run/secrets/secret:/run/deployment-control-plane/credentials/artifact-store-secret-access-key:ro",
      ),
    );
  });
});

test("control-plane NixOS container module fails closed for required host-local inputs", async () => {
  await runInTemp("control-plane-nixos-container-assertions", async (tmp, $) => {
    const out = await evalModule(
      tmp,
      $,
      `
      manageNginx = true;
      publicHostName = null;
    `,
      `{
      failedAssertions = map (item: item.message) (
        builtins.filter
          (item: !item.assertion && lib.hasPrefix "deploymentControlPlaneContainer" item.message)
          system.config.assertions
      );
    }`,
      {
        bucket: false,
        credentials: `
        credentials = {
          control-plane-database-url.source = "/run/secrets/db";
          reviewed-source-ssh-key.source = "/run/secrets/ssh";
          artifact-store-endpoint.source = "/run/secrets/endpoint";
          artifact-store-access-key-id.source = "/run/secrets/access";
        };
      `,
      },
    );
    assert.deepEqual(out.failedAssertions, [
      "deploymentControlPlaneContainer.artifactStore.bucket is required.",
      "deploymentControlPlaneContainer missing credential sources: artifact-store-secret-access-key",
      "deploymentControlPlaneContainer.publicHostName is required when manageNginx = true.",
    ]);
  });
});

test("control-plane NixOS container module parameterizes image and gated nginx", async () => {
  await runInTemp("control-plane-nixos-container-nginx", async (tmp, $) => {
    const out = await evalModule(
      tmp,
      $,
      `
      imageRegistry = "registry.ops.example";
      imageRepository = "deploy/control-plane";
      imageDigest = "sha256:reviewed";
      publicHostName = "deploy.example.test";
      manageNginx = true;
    `,
      `{
      image = system.config.virtualisation.oci-containers.containers.deployment-control-plane-service.image;
      nginxEnabled = system.config.services.nginx.enable;
      proxyPass =
        system.config.services.nginx.virtualHosts."deploy.example.test".locations."/".proxyPass;
    }`,
      { image: false },
    );
    assert.equal(out.image, "registry.ops.example/deploy/control-plane@sha256:reviewed");
    assert.equal(out.nginxEnabled, true);
    assert.equal(out.proxyPass, "http://127.0.0.1:7780");
  });
});
