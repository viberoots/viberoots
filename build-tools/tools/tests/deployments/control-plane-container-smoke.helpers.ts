#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Runtime = {
  bin: string;
  args: string[];
};

export type ContainerSmokeImage = {
  outPath: string;
  repoTag: string;
};

export async function findContainerRuntime(): Promise<Runtime | null> {
  for (const bin of ["podman", "docker"]) {
    const available = await execFileAsync("sh", ["-c", `command -v ${bin}`]).then(
      () => true,
      () => false,
    );
    if (!available) continue;
    const args = bin === "podman" ? ["--events-backend=file"] : [];
    const info = await execFileAsync(bin, [...args, "info"], { timeout: 10_000 }).then(
      () => true,
      () => false,
    );
    if (info) return { bin, args };
  }
  return null;
}

export async function writeContainerSmokeRuntimeTree(root: string, port: number) {
  const configDir = path.join(root, "config");
  const knownHostsPath = path.join(configDir, "github-known-hosts");
  const credentialsDir = path.join(root, "credentials");
  const recordsRoot = path.join(root, "records");
  const artifactsRoot = path.join(root, "artifacts");
  const runtimeRoot = path.join(root, "runtime");
  for (const dir of [configDir, credentialsDir, recordsRoot, artifactsRoot, runtimeRoot]) {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.chmod(dir, 0o777);
  }
  const credentialFiles: Record<string, string> = {
    "artifact-store-endpoint": "http://127.0.0.1:9",
    "artifact-store-access-key-id": "smoke-access-key",
    "artifact-store-secret-access-key": "smoke-secret-key",
    "control-plane-database-url": "pgmem://container-smoke-secret-database-url",
    "reviewed-source-ssh-key": [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "smoke-ssh-key",
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n"),
    "reviewed-source-known-hosts": "github.com ssh-ed25519 AAAA",
  };
  for (const [name, value] of Object.entries(credentialFiles)) {
    await fsp.writeFile(path.join(credentialsDir, name), `${value}\n`, "utf8");
    await fsp.chmod(path.join(credentialsDir, name), 0o644);
  }
  await fsp.writeFile(knownHostsPath, "github.com ssh-ed25519 AAAA\n", "utf8");
  await fsp.chmod(knownHostsPath, 0o644);
  const configPath = path.join(configDir, "config.yaml");
  await fsp.writeFile(
    configPath,
    [
      "instanceId: container-smoke",
      "service:",
      "  host: 0.0.0.0",
      `  port: ${port}`,
      "  publicUrl: http://127.0.0.1",
      "storage:",
      "  recordsRoot: /var/lib/deployment-control-plane/records",
      "  artifactStagingRoot: /var/lib/deployment-control-plane/artifacts",
      "  runtimeRoot: /var/lib/deployment-control-plane/runtime",
      "  artifactStore:",
      "    bucket: deploy-artifacts",
      "    endpointFile: /run/deployment-control-plane/credentials/artifact-store-endpoint",
      "    accessKeyIdFile: /run/deployment-control-plane/credentials/artifact-store-access-key-id",
      "    secretAccessKeyFile: /run/deployment-control-plane/credentials/artifact-store-secret-access-key",
      "database:",
      "  urlFile: /run/deployment-control-plane/credentials/control-plane-database-url",
      "credentials:",
      "  directory: /run/deployment-control-plane/credentials",
      "reviewedSource:",
      "  sshKeyFile: /run/deployment-control-plane/credentials/reviewed-source-ssh-key",
      "  sshKnownHostsFile: /run/deployment-control-plane/credentials/reviewed-source-known-hosts",
      "",
    ].join("\n"),
    "utf8",
  );
  return { configPath, knownHostsPath, credentialsDir, recordsRoot, artifactsRoot, runtimeRoot };
}

export async function loadImage(runtime: Runtime, image: ContainerSmokeImage): Promise<void> {
  await execFileAsync(runtime.bin, [...runtime.args, "load", "-i", image.outPath], {
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

export async function runControlPlaneContainer(opts: {
  runtime: Runtime;
  image: ContainerSmokeImage;
  name: string;
  mounts: Awaited<ReturnType<typeof writeContainerSmokeRuntimeTree>>;
  command: string[];
  env?: Record<string, string>;
  publishPort?: number;
  network?: string;
  extraMounts?: string[];
}) {
  const args = [
    ...opts.runtime.args,
    "run",
    "--rm",
    "-d",
    "--name",
    opts.name,
    ...(opts.network ? ["--network", opts.network] : []),
    "--mount",
    `type=bind,source=${opts.mounts.configPath},target=/etc/deployment-control-plane/config.yaml,readonly`,
    "--mount",
    `type=bind,source=${opts.mounts.knownHostsPath},target=/etc/deployment-control-plane/github-known-hosts,readonly`,
    "--mount",
    `type=bind,source=${opts.mounts.credentialsDir},target=/run/deployment-control-plane/credentials,readonly`,
    "--mount",
    `type=bind,source=${opts.mounts.recordsRoot},target=/var/lib/deployment-control-plane/records`,
    "--mount",
    `type=bind,source=${opts.mounts.artifactsRoot},target=/var/lib/deployment-control-plane/artifacts`,
    "--mount",
    `type=bind,source=${opts.mounts.runtimeRoot},target=/var/lib/deployment-control-plane/runtime`,
    ...(opts.extraMounts || []).flatMap((mount) => ["--mount", mount]),
    ...Object.entries(opts.env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    ...(opts.publishPort ? ["-p", `127.0.0.1:${opts.publishPort}:${opts.publishPort}`] : []),
    opts.image.repoTag,
    ...opts.command,
  ];
  await execFileAsync(opts.runtime.bin, args, { timeout: 60_000, maxBuffer: 1024 * 1024 });
}

export async function removeContainer(runtime: Runtime, name: string): Promise<void> {
  await execFileAsync(runtime.bin, [...runtime.args, "rm", "-f", name], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  }).catch(() => {});
}

export async function assertContainerUser(runtime: Runtime, name: string): Promise<void> {
  const { stdout } = await execFileAsync(runtime.bin, [...runtime.args, "exec", name, "id", "-u"], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(stdout.trim(), "10001");
}

export async function assertContainerCommand(
  runtime: Runtime,
  name: string,
  command: string[],
  expected: RegExp,
): Promise<void> {
  const { stdout } = await execFileAsync(runtime.bin, [...runtime.args, "exec", name, ...command], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  assert.match(stdout.trim(), expected);
}

export async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) {
        const body = await response.json();
        assert.equal(body.ok, true);
        assert.equal(body.instanceId, "container-smoke");
        return;
      }
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`container service health did not become ready: ${String(lastError)}`);
}

export async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("unable to allocate a local port"));
      });
    });
    server.on("error", reject);
  });
}
