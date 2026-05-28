#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { parseControlPlaneRuntimeConfig } from "../../deployments/control-plane-runtime-config";
import {
  assertContainerUser,
  findContainerRuntime,
  freePort,
  loadImage,
  removeContainer,
  runControlPlaneContainer,
  waitForHealth,
  writeContainerSmokeRuntimeTree,
} from "./control-plane-container-smoke.helpers";
import { buildImageTarball } from "./control-plane-oci-image.helpers";
import { loadNixosDefaults, loadNixosRenderedConfig } from "./control-plane-host-profile.helpers";
import { runInTemp } from "../lib/test-helpers";
const PROFILE_DIR = "build-tools/tools/deployments/control-plane-host-profile";
const CONFIG_PATH = "/etc/deployment-control-plane/config.yaml";
const CREDENTIAL_DIR = "/run/deployment-control-plane/credentials";
const KNOWN_HOSTS_PATH = `${CREDENTIAL_DIR}/reviewed-source-known-hosts`;
const RECORDS_ROOT = "/var/lib/deployment-control-plane/records";
const ARTIFACTS_ROOT = "/var/lib/deployment-control-plane/artifacts";
const RUNTIME_ROOT = "/var/lib/deployment-control-plane/runtime";
const REQUIRED_MOUNTS = [CONFIG_PATH, CREDENTIAL_DIR, RECORDS_ROOT, ARTIFACTS_ROOT, RUNTIME_ROOT];
const SECRET_ENV_PATTERN = /(secret|token|password|credential|database|access.key|ssh)/i;
const COMPOSE_IMAGE_REF =
  "${VBR_CONTROL_PLANE_IMAGE_REGISTRY:?set image registry}/${VBR_CONTROL_PLANE_IMAGE_REPOSITORY:?set image repository}@${VBR_CONTROL_PLANE_IMAGE_DIGEST:?set immutable sha256 image digest}";

type ComposeService = {
  image?: string;
  command?: string[];
  ports?: string[];
  volumes?: Array<{ target?: string; read_only?: boolean }>;
  environment?: Record<string, string>;
  env_file?: unknown;
};

async function readProfileFile(name: string): Promise<string> {
  return await fsp.readFile(path.join(process.cwd(), PROFILE_DIR, name), "utf8");
}

async function readCompose(): Promise<Record<string, ComposeService>> {
  const compose = YAML.parse(await readProfileFile("compose.yaml")) as {
    services: Record<string, ComposeService>;
  };
  return compose.services;
}

function assertCommand(service: ComposeService, mode: "service" | "worker") {
  assert.deepEqual(service.command, ["deployment-control-plane", mode, "--config", CONFIG_PATH]);
}

function assertMounts(service: ComposeService) {
  const mounts = new Set((service.volumes || []).map((volume) => volume.target));
  for (const mount of REQUIRED_MOUNTS) assert.ok(mounts.has(mount), `missing mount ${mount}`);
  assert.equal(service.volumes?.find((volume) => volume.target === CONFIG_PATH)?.read_only, true);
  assert.equal(
    service.volumes?.find((volume) => volume.target === CREDENTIAL_DIR)?.read_only,
    true,
  );
}

function assertNoCredentialEnvironment(service: ComposeService) {
  assert.equal(service.env_file, undefined);
  for (const key of Object.keys(service.environment || {})) {
    assert.ok(
      key.startsWith("VBR_CONTROL_PLANE_IMAGE_") || !SECRET_ENV_PATTERN.test(key),
      `unexpected credential-like environment key ${key}`,
    );
  }
}

test("non-NixOS Compose profile defines one service and two workers", async () => {
  const services = await readCompose();
  assert.deepEqual(Object.keys(services).sort(), [
    "control-plane-service",
    "control-plane-worker-1",
    "control-plane-worker-2",
  ]);
  assertCommand(services["control-plane-service"], "service");
  assertCommand(services["control-plane-worker-1"], "worker");
  assertCommand(services["control-plane-worker-2"], "worker");
  assert.deepEqual(services["control-plane-service"].ports, [
    "127.0.0.1:${VBR_CONTROL_PLANE_PORT:-7780}:7780",
  ]);
  for (const service of Object.values(services)) {
    assert.equal(service.image, COMPOSE_IMAGE_REF);
    assert.equal(
      service.environment?.VBR_CONTROL_PLANE_IMAGE_DIGEST_STATUS,
      "verified-registry-publication",
    );
    assertMounts(service);
    assertNoCredentialEnvironment(service);
  }
});

test("non-NixOS profile config matches the shared runtime credential contract", async () => {
  const configText = await readProfileFile("config.example.yaml");
  const smokeText = await readProfileFile("config.local-smoke.yaml");
  const config = parseControlPlaneRuntimeConfig(configText);
  const smoke = parseControlPlaneRuntimeConfig(smokeText);
  const nixosConfig = await loadNixosRenderedConfig();
  const defaults = await loadNixosDefaults();
  assert.deepEqual(config, {
    ...nixosConfig,
    reviewedSource: { ...nixosConfig.reviewedSource, sshKnownHostsFile: KNOWN_HOSTS_PATH },
  });
  assert.equal(config.service.host, "0.0.0.0");
  assert.equal(config.service.port, defaults.servicePort);
  assert.equal(
    config.service.tokenFile,
    `${defaults.credentialDirectory}/${defaults.controlPlaneTokenCredential}`,
  );
  assert.equal(config.credentials.directory, defaults.credentialDirectory);
  assert.equal(config.storage.recordsRoot, defaults.recordsRoot);
  assert.equal(config.storage.artifactStagingRoot, defaults.artifactStagingRoot);
  assert.equal(config.storage.runtimeRoot, defaults.runtimeRoot);
  assert.equal(
    config.database.urlFile,
    `${defaults.credentialDirectory}/${defaults.databaseUrlCredential}`,
  );
  assert.equal(
    config.storage.artifactStore.endpointFile,
    `${defaults.credentialDirectory}/${defaults.artifactEndpointCredential}`,
  );
  assert.equal(
    config.storage.artifactStore.accessKeyIdFile,
    `${defaults.credentialDirectory}/${defaults.artifactAccessKeyIdCredential}`,
  );
  assert.equal(
    config.storage.artifactStore.secretAccessKeyFile,
    `${defaults.credentialDirectory}/${defaults.artifactSecretAccessKeyCredential}`,
  );
  assert.equal(
    config.reviewedSource.sshKeyFile,
    `${defaults.credentialDirectory}/${defaults.reviewedSourceSshKeyCredential}`,
  );
  assert.equal(config.reviewedSource.sshKnownHostsFile, KNOWN_HOSTS_PATH);
  assert.deepEqual(smoke.webUi, { ...nixosConfig.webUi, enabled: false });
  assert.deepEqual(smoke.mcp, { ...nixosConfig.mcp, enabled: false });
});

test("direct Podman example preserves the same runtime contract", async () => {
  const text = await readProfileFile("podman-run.example.txt");
  assert.match(text, /VBR_CONTROL_PLANE_IMAGE_REF=/);
  assert.match(text, /\^sha256:\[0-9a-f\]\{64\}\$/);
  assert.match(text, /\^nix-source-\[0-9a-f\]\{64\}\$/);
  assert.match(text, /VBR_CONTROL_PLANE_IMAGE_DIGEST must be sha256:<64 lowercase hex>/);
  assert.match(text, /VBR_CONTROL_PLANE_IMAGE_DIGEST_STATUS="verified-registry-publication"/);
  assert.doesNotMatch(text, /VBR_CONTROL_PLANE_IMAGE:\?/);
  assert.doesNotMatch(text, /IMAGE_DIGEST:-unknown/);
  assert.match(text, /podman pod create/);
  assert.match(text, /--publish 127\.0\.0\.1:7780:7780/);
  assert.equal((text.match(/deployment-control-plane service --config/g) || []).length, 1);
  assert.equal((text.match(/deployment-control-plane worker --config/g) || []).length, 2);
  for (const mount of REQUIRED_MOUNTS) assert.match(text, new RegExp(escapeRegExp(mount)));
  assert.doesNotMatch(text, /env-file|POSTGRES|DATABASE_URL|SECRET_ACCESS_KEY|PRIVATE KEY/i);
});

test("non-NixOS host profile docs preserve Docker and Podman boundaries", async () => {
  const doc = await fsp.readFile(
    path.join(process.cwd(), "docs/control-plane-non-nixos-host-profile.md"),
    "utf8",
  );
  assert.match(doc, /not a separate deployment authority/i);
  assert.match(doc, /Docker-compatible Compose or Podman/i);
  assert.match(doc, /127\.0\.0\.1:7780/i);
  assert.match(doc, /End-To-End Fixture/i);
  assert.match(doc, /deployments_control_plane_container_e2e/);
  assert.match(doc, /one service container and two worker containers/i);
  assert.match(doc, /SaaS Host Capability Matrix/i);
  assert.match(doc, /Render Docker services/);
  assert.match(doc, /Northflank services or jobs/);
  assert.match(doc, /Google Cloud Run services/);
  assert.match(doc, /VBR_CONTROL_PLANE_LIVE_RENDER_SUBSTRATE/);
  assert.match(doc, /Platforms that cannot mount credential files are rejected/i);
});

test("non-NixOS local smoke profile runs service and workers when OCI runtime is available", async (t) => {
  const runtime = await findContainerRuntime();
  if (!runtime) {
    t.skip("no usable local Podman or Docker daemon is available");
    return;
  }
  const image = await buildImageTarball();
  const token = `host-profile-${process.pid}`;
  const serviceName = `vbr-cp-profile-service-${token}`;
  const workerNames = [`vbr-cp-profile-worker-1-${token}`, `vbr-cp-profile-worker-2-${token}`];
  await runInTemp("control-plane-host-profile-smoke", async (tmp) => {
    const port = await freePort();
    const mounts = await writeContainerSmokeRuntimeTree(tmp, port);
    await writeProfileSmokeConfig(mounts.configPath, port);
    await loadImage(runtime, image);
    try {
      await runControlPlaneContainer({
        runtime,
        image,
        name: serviceName,
        mounts,
        publishPort: port,
        command: ["service", "--config", CONFIG_PATH],
      });
      await waitForHealth(port);
      assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 404);
      assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST" })).status, 404);
      await assertContainerUser(runtime, serviceName);
      for (const [index, name] of workerNames.entries()) {
        await runControlPlaneContainer({
          runtime,
          image,
          name,
          mounts,
          command: [
            "worker",
            "--config",
            CONFIG_PATH,
            "--worker-id",
            `host-profile-worker-${index + 1}`,
            "--poll-ms",
            "1000",
          ],
        });
        await assertContainerUser(runtime, name);
      }
    } finally {
      await removeContainer(runtime, serviceName);
      for (const name of workerNames) await removeContainer(runtime, name);
    }
  });
});

async function writeProfileSmokeConfig(configPath: string, port: number) {
  const text = (await readProfileFile("config.local-smoke.yaml"))
    .replace("instanceId: local-smoke", "instanceId: container-smoke")
    .replace("port: 7780", `port: ${port}`)
    .replace("publicUrl: http://127.0.0.1:7780", `publicUrl: http://127.0.0.1:${port}`);
  await fsp.writeFile(configPath, text, "utf8");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
