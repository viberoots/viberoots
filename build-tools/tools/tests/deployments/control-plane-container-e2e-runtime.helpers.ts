#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ContainerSmokeImage } from "./control-plane-container-smoke.helpers";

const execFileAsync = promisify(execFile);

type Runtime = { bin: string; args: string[] };

type Mounts = {
  configPath: string;
  knownHostsPath: string;
  credentialsDir: string;
  recordsRoot: string;
  artifactsRoot: string;
  runtimeRoot: string;
};

export async function assertContainerRejectsMissingSecret(opts: {
  runtime: Runtime;
  image: ContainerSmokeImage;
  mounts: Mounts;
}) {
  await fsp.rm(path.join(opts.mounts.credentialsDir, "artifact-store-secret-access-key"));
  const result = await execFileAsync(
    opts.runtime.bin,
    [
      ...opts.runtime.args,
      "run",
      "--rm",
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
      opts.image.repoTag,
      "service",
      "--config",
      "/etc/deployment-control-plane/config.yaml",
    ],
    { timeout: 60_000, maxBuffer: 1024 * 1024 },
  ).then(
    () => ({ code: 0, output: "" }),
    (error: any) => ({
      code: Number(error?.code || 1),
      output: `${error?.stdout || ""}\n${error?.stderr || ""}`,
    }),
  );
  assert.notEqual(result.code, 0);
  assert.match(result.output, /artifact-store-secret-access-key/);
  assert.doesNotMatch(result.output, /smoke-secret-key|BEGIN OPENSSH PRIVATE KEY/);
}
