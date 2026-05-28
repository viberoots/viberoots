#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { evalModule, REVIEWED_IMAGE_DIGEST } from "./control-plane-nixos-container-module.helpers";

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
      "service",
      "--config",
      "/etc/deployment-control-plane/config.yaml",
    ]);
    assert.deepEqual(service.ports, ["127.0.0.1:7780:7780"]);
    assert.ok(service.extraOptions.some((option) => option.startsWith("--health-cmd=")));
    assert.ok(
      service.volumes.includes(
        "/run/deployment-control-plane-container-credentials/deployment-control-plane-service:/run/deployment-control-plane/credentials:ro",
      ),
    );
    assert.ok(!service.volumes.some((volume) => volume.includes("github-known-hosts")));
    const rendered = JSON.parse(String(out.configText));
    assert.equal(rendered.instanceId, "mini");
    assert.equal(rendered.service.host, "0.0.0.0");
    assert.equal(
      rendered.service.tokenFile,
      "/run/deployment-control-plane/credentials/control-plane-token",
    );
    assert.equal(rendered.storage.artifactStore.bucket, "deployment-artifacts");
    assert.equal(rendered.storage.artifactStore.region, "us-east-1");
    assert.equal(
      rendered.credentials.infisicalDeployments[0].deploymentId,
      "cloud-control-fixture-staging",
    );
    assert.equal(rendered.webUi.enabled, true);
    assert.ok(
      (out.tmpfiles as string[]).includes(
        "d /var/lib/deployment-control-plane/records 0750 10001 10001 -",
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
      servicePreStart =
        system.config.systemd.services.docker-deployment-control-plane-service.preStart;
      workerLoadCredential =
        system.config.systemd.services.docker-deployment-control-plane-worker-1.serviceConfig.LoadCredential;
      workerPreStart =
        system.config.systemd.services.docker-deployment-control-plane-worker-1.preStart;
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
    assert.ok(
      (out.serviceLoadCredential as string[]).includes(
        "reviewed-source-known-hosts:/run/secrets/known-hosts",
      ),
    );
    assert.ok(
      (out.serviceLoadCredential as string[]).includes(
        "cloud-control-fixture-staging-infisical-client-secret:/run/secrets/infisical-secret",
      ),
    );
    assert.match(String(out.servicePreStart), /install -d -m 0500 -o 10001 -g 10001/);
    assert.match(
      String(out.workerPreStart),
      new RegExp(
        "deployment-control-plane-container-credentials/deployment-control-plane-worker-1",
      ),
    );
    const service = out.service as {
      environment: Record<string, string>;
      extraOptions: string[];
      ports: string[];
    };
    assert.deepEqual(service.ports, ["127.0.0.1:7780:7780"]);
    assert.deepEqual(service.environment, {
      TMPDIR: "/var/lib/deployment-control-plane/runtime/tmp",
      VBR_CONTROL_PLANE_IMAGE_DIGEST: REVIEWED_IMAGE_DIGEST,
      VBR_CONTROL_PLANE_IMAGE_DIGEST_STATUS: "build-only",
      VBR_CONTROL_PLANE_IMAGE_REF: `registry.example.com/platform/deployment-control-plane@${REVIEWED_IMAGE_DIGEST}`,
      WORKSPACE_ROOT: "/var/lib/deployment-control-plane/runtime/workspace",
    });
    assert.ok(service.extraOptions.includes("--health-interval=30s"));
    const worker = out.worker as { cmd: string[]; volumes: string[] };
    assert.deepEqual(worker.cmd.slice(0, 1), ["worker"]);
    assert.ok(
      worker.volumes.includes(
        "/run/deployment-control-plane-container-credentials/deployment-control-plane-worker-1:/run/deployment-control-plane/credentials:ro",
      ),
    );
  });
});

test("control-plane NixOS container module can use host networking with loopback service bind", async () => {
  await runInTemp("control-plane-nixos-container-host-network", async (tmp, $) => {
    const out = await evalModule(
      tmp,
      $,
      `
      containerRuntime = "docker";
      networkMode = "host";
      serviceHost = "127.0.0.1";
      workerReplicas = 1;
    `,
      `{
      service = system.config.virtualisation.oci-containers.containers.deployment-control-plane-service;
      worker = system.config.virtualisation.oci-containers.containers.deployment-control-plane-worker-1;
      configText = system.config.environment.etc."deployment-control-plane/config.yaml".text;
    }`,
    );
    const service = out.service as {
      extraOptions: string[];
      ports: string[];
    };
    const worker = out.worker as {
      extraOptions: string[];
      ports?: string[];
    };
    assert.deepEqual(service.ports, []);
    assert.ok(service.extraOptions.includes("--network=host"));
    assert.ok(worker.extraOptions.includes("--network=host"));
    const rendered = JSON.parse(String(out.configText));
    assert.equal(rendered.service.host, "127.0.0.1");
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
          reviewed-source-known-hosts.source = "/run/secrets/known-hosts";
          cloud-control-fixture-staging-infisical-client-id.source = "/run/secrets/infisical-id";
          cloud-control-fixture-staging-infisical-client-secret.source = "/run/secrets/infisical-secret";
          artifact-store-endpoint.source = "/run/secrets/endpoint";
          artifact-store-access-key-id.source = "/run/secrets/access";
          control-plane-token.source = "/run/secrets/control-plane-token";
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
      imageDigest = "${REVIEWED_IMAGE_DIGEST}";
      imageSourceRevision = "source-nginx";
      imageBuildIdentity = "nix-source-${"b".repeat(64)}";
      imageInspectedDigest = "${REVIEWED_IMAGE_DIGEST}";
      imageTag = "registry.ops.example/deploy/control-plane:source-nginx";
      imageDigestStatus = "verified-registry-publication";
      publicHostName = "deploy.example.test";
      manageNginx = true;
    `,
      `let
      env = system.config.virtualisation.oci-containers.containers.deployment-control-plane-service.environment;
    in {
      image = system.config.virtualisation.oci-containers.containers.deployment-control-plane-service.image;
      imageDigestEnv = env.VBR_CONTROL_PLANE_IMAGE_DIGEST;
      imageDigestStatusEnv = env.VBR_CONTROL_PLANE_IMAGE_DIGEST_STATUS;
      imageBuildIdentityEnv = env.VBR_CONTROL_PLANE_IMAGE_BUILD_IDENTITY;
      nginxEnabled = system.config.services.nginx.enable;
      proxyPass =
        system.config.services.nginx.virtualHosts."deploy.example.test".locations."/".proxyPass;
    }`,
      { image: false },
    );
    assert.equal(out.image, `registry.ops.example/deploy/control-plane@${REVIEWED_IMAGE_DIGEST}`);
    assert.equal(out.imageDigestEnv, REVIEWED_IMAGE_DIGEST);
    assert.equal(out.imageDigestStatusEnv, "verified-registry-publication");
    assert.equal(out.imageBuildIdentityEnv, `nix-source-${"b".repeat(64)}`);
    assert.equal(out.nginxEnabled, true);
    assert.equal(out.proxyPass, "http://127.0.0.1:7780");
  });
});
