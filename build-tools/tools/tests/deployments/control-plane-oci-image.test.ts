#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { readControlPlaneImageMetadata } from "../../deployments/control-plane-image-metadata";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import {
  assertContainerCommand,
  assertContainerUser,
  findContainerRuntime,
  freePort,
  loadImage,
  removeContainer,
  runControlPlaneContainer,
  waitForHealth,
  writeContainerSmokeRuntimeTree,
} from "./control-plane-container-smoke.helpers";
import {
  assertNoSecretPayloads,
  assertProhibitedPathContract,
  buildControlPlaneRuntime,
  buildImageContract,
  buildImageTarball,
  layerPathMatches,
} from "./control-plane-oci-image.helpers";
import { readJson } from "./nixos-shared-host.control-plane.helpers";
import { runInTemp } from "../lib/test-helpers";

const TOKEN = "oci-image-test-token";
const execFileAsync = promisify(execFile);

test("control-plane image contract exposes service and worker entrypoints without host secrets", async () => {
  const first = await buildImageContract();
  const second = await buildImageContract();
  const image = await buildImageTarball();
  assert.equal(first.outPath, second.outPath);
  assert.deepEqual(image.config.config.Entrypoint, ["/bin/deployment-control-plane"]);
  assert.equal(image.config.config.User, "10001:10001");
  assert.equal(
    image.config.config.Labels["org.opencontainers.image.title"],
    "deployment-control-plane",
  );
  assert.equal(
    image.config.config.Labels["org.opencontainers.image.revision"],
    first.contract.sourceRevision,
  );
  assert.equal(image.config.config.Labels["org.opencontainers.image.digest"], "unknown");
  assert.match(first.contract.sourceRevision, /^source-[a-z0-9]{12}$/);
  assert.deepEqual(first.contract.commands, [
    "deployment-control-plane service --config /etc/deployment-control-plane/config.yaml",
    "deployment-control-plane worker --config /etc/deployment-control-plane/config.yaml",
  ]);
  assert.equal(first.contract.user, "10001:10001");
  for (const tool of ["node", "git", "ssh", "tofu", "aws", "kubectl", "helm"]) {
    assert.ok(first.contract.includedTools.includes(tool), `missing runtime tool ${tool}`);
  }
  assert.ok(first.contract.includedTools.includes("wrangler"), "missing runtime tool wrangler");
  for (const mount of [
    "/etc/deployment-control-plane/config.yaml",
    "/run/deployment-control-plane/credentials",
    "/var/lib/deployment-control-plane/records",
    "/var/lib/deployment-control-plane/artifacts",
    "/var/lib/deployment-control-plane/runtime",
  ]) {
    assert.ok(first.contract.requiredMounts.includes(mount), `missing mount ${mount}`);
  }
  assertNoSecretPayloads(first.contract);
  assertProhibitedPathContract(first.contract);
  assertNoSecretPayloads(image.config);
  assertNoSecretPayloads(image.layerPaths);
  assert.ok(
    image.rootFilesystemPaths.includes("bin/wrangler"),
    "image root filesystem is missing /bin/wrangler",
  );
  for (const prohibitedPath of first.contract.prohibitedPaths) {
    assert.ok(
      !image.layerPaths.some((layerPath) => layerPathMatches(layerPath, prohibitedPath)),
      `image layer unexpectedly includes ${prohibitedPath}`,
    );
  }
});

test("control-plane Nix runtime exposes non-mutating service and worker help", async () => {
  const runtime = await buildControlPlaneRuntime();
  for (const mode of ["service", "worker"]) {
    const { stdout } = await execFileAsync(runtime.commandPath, [mode, "--help"], {
      cwd: process.cwd(),
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    assert.match(stdout, new RegExp(`deployment-control-plane ${mode} --config <path>`));
  }
});

test("control-plane image runs service and worker with mounted config and credentials", async (t) => {
  const runtime = await findContainerRuntime();
  if (!runtime) {
    t.skip("no usable local Podman or Docker daemon is available");
    return;
  }
  const image = await buildImageTarball();
  const token = `container-smoke-${process.pid}`;
  const serviceName = `vbr-cp-service-${token}`;
  const workerName = `vbr-cp-worker-${token}`;
  await runInTemp("control-plane-container-smoke", async (tmp) => {
    const port = await freePort();
    const mounts = await writeContainerSmokeRuntimeTree(tmp, port);
    await loadImage(runtime, image);
    try {
      await runControlPlaneContainer({
        runtime,
        image,
        name: serviceName,
        mounts,
        publishPort: port,
        command: ["service", "--config", "/etc/deployment-control-plane/config.yaml"],
      });
      await waitForHealth(port);
      await assertContainerUser(runtime, serviceName);
      await assertContainerCommand(
        runtime,
        serviceName,
        ["/bin/wrangler", "--version"],
        /wrangler/i,
      );
      await runControlPlaneContainer({
        runtime,
        image,
        name: workerName,
        mounts,
        command: [
          "worker",
          "--config",
          "/etc/deployment-control-plane/config.yaml",
          "--worker-id",
          "container-smoke-worker",
          "--poll-ms",
          "1000",
        ],
      });
      await assertContainerUser(runtime, workerName);
    } finally {
      await removeContainer(runtime, serviceName);
      await removeContainer(runtime, workerName);
    }
  });
});

test("control-plane image metadata is non-secret and visible from service status APIs", async () => {
  await runInTemp("control-plane-oci-metadata", async (tmp) => {
    const env = {
      VBR_CONTROL_PLANE_VERSION: "7.0.0-test",
      VBR_CONTROL_PLANE_SOURCE_REVISION: "abc1234",
      VBR_CONTROL_PLANE_IMAGE_DIGEST: "sha256:feedface",
    };
    assert.deepEqual(readControlPlaneImageMetadata(env), {
      version: "7.0.0-test",
      sourceRevision: "abc1234",
      imageDigest: "sha256:feedface",
    });
    const recordsRoot = path.join(tmp, "records");
    const service = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: { statePath: path.join(tmp, "state.json"), hostRoot: tmp, recordsRoot },
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot),
      token: TOKEN,
      objectStore: memoryControlPlaneArtifactStore(),
      instanceId: "oci-instance",
      env,
    });
    try {
      const health = await readJson<any>(await fetch(new URL("/healthz", service.url)));
      assert.equal(health.image.imageDigest, "sha256:feedface");
      assert.equal(health.image.sourceRevision, "abc1234");
      const status = await readJson<any>(
        await fetch(new URL("/api/v1/read/status", service.url), {
          headers: { authorization: `Bearer ${TOKEN}` },
        }),
      );
      assert.equal(status.image.version, "7.0.0-test");
      assert.doesNotMatch(JSON.stringify(status), /token|postgres:\/\/|PRIVATE KEY/i);
    } finally {
      await service.close();
    }
  });
});
