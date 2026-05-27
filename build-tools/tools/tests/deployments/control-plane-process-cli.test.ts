#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runDeploymentControlPlaneCommand } from "../../deployments/deployment-control-plane";
import {
  withControlPlaneArgv,
  writeRuntimeConfig,
} from "./control-plane-process-entrypoints.helpers";
import { runInTemp } from "../lib/test-helpers";

const SETUP_IMAGE =
  "registry.example.com/platform/deployment-control-plane@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("deployment-control-plane command validates mode config overrides and credentials", async () => {
  await runInTemp("control-plane-cli-config", async (tmp) => {
    await assert.rejects(
      () => withControlPlaneArgv(["status"], runDeploymentControlPlaneCommand),
      /usage:/,
    );
    await assert.rejects(
      () => withControlPlaneArgv(["service"], runDeploymentControlPlaneCommand),
      /--config/,
    );
    await assert.rejects(
      () => withControlPlaneArgv(["worker"], runDeploymentControlPlaneCommand),
      /--config/,
    );
    const malformedPath = path.join(tmp, "malformed.yaml");
    await fsp.writeFile(malformedPath, "not: [valid\n", "utf8");
    await assert.rejects(
      () =>
        withControlPlaneArgv(["service", "--config", malformedPath], async () => {
          await runDeploymentControlPlaneCommand();
        }),
      /Flow sequence in block collection/,
    );
    const missing = await writeRuntimeConfig(path.join(tmp, "missing"), { omit: ["secret"] });
    await assert.rejects(
      () =>
        withControlPlaneArgv(
          ["worker", "--config", missing.configPath, "--worker-id", "worker-missing"],
          async () => {
            await runDeploymentControlPlaneCommand();
          },
        ),
      /missing required credential files/,
    );
    const serviceConfig = await writeRuntimeConfig(path.join(tmp, "service"));
    await assert.rejects(
      () =>
        withControlPlaneArgv(
          ["service", "--config", serviceConfig.configPath, "--token", "argv-secret"],
          runDeploymentControlPlaneCommand,
        ),
      /requires service\.tokenFile, not --token/,
    );
    const service = await withControlPlaneArgv(
      ["service", "--config", serviceConfig.configPath],
      runDeploymentControlPlaneCommand,
    );
    assert.match((service as any).url, /^http:\/\/127\.0\.0\.1:/);
    await (service as any).close();
    const workerConfig = await writeRuntimeConfig(path.join(tmp, "worker"));
    const worker = await withControlPlaneArgv(
      ["worker", "--config", workerConfig.configPath, "--worker-id", "worker-cli"],
      runDeploymentControlPlaneCommand,
    );
    assert.equal((worker as any).workerId, "worker-cli");
    await (worker as any).close();
  });
});

test("deployment-control-plane setup writes a cloud host profile bundle", async () => {
  await runInTemp("control-plane-cli-setup", async (tmp) => {
    const out = path.join(tmp, "profile");
    await withControlPlaneArgv(
      [
        "setup",
        "--out",
        out,
        "--host-mode",
        "aws-ec2",
        "--image",
        SETUP_IMAGE,
        "--aws-vpc-endpoint",
        "--aws-subnet-id",
        "subnet-123",
        "--aws-security-group-id",
        "sg-123",
        "--tls-evidence",
        "alb-listener-dns-reviewed",
      ],
      runDeploymentControlPlaneCommand,
    );
    assert.ok(await exists(path.join(out, "config.yaml")));
    assert.ok(await exists(path.join(out, "credential-manifest.json")));
    assert.ok(await exists(path.join(out, "provider-capabilities.json")));
    assert.match(await fsp.readFile(path.join(out, "aws-ec2-profile.md"), "utf8"), /AWS S3/);
  });
});

test("deployment-control-plane standby process modes gate service and workers", async () => {
  await runInTemp("control-plane-cli-standby", async (tmp) => {
    const serviceOnly = await writeRuntimeConfig(path.join(tmp, "service-only"), {
      processMode: "service-only",
    });
    await assert.rejects(
      () =>
        withControlPlaneArgv(
          ["worker", "--config", serviceOnly.configPath, "--worker-id", "blocked"],
          runDeploymentControlPlaneCommand,
        ),
      /worker mode is disabled/,
    );
    const workerOnly = await writeRuntimeConfig(path.join(tmp, "worker-only"), {
      processMode: "worker-only",
    });
    await assert.rejects(
      () =>
        withControlPlaneArgv(["service", "--config", workerOnly.configPath], async () => {
          await runDeploymentControlPlaneCommand();
        }),
      /service mode is disabled/,
    );
    const disabled = await writeRuntimeConfig(path.join(tmp, "disabled"), {
      processMode: "fully-disabled",
    });
    await assert.rejects(
      () =>
        withControlPlaneArgv(
          ["worker", "--config", disabled.configPath, "--process-mode", "fully-disabled"],
          runDeploymentControlPlaneCommand,
        ),
      /process mode is disabled/,
    );
    const reenabled = await withControlPlaneArgv(
      [
        "worker",
        "--config",
        disabled.configPath,
        "--process-mode",
        "fully-enabled",
        "--worker-id",
        "reenabled-worker",
      ],
      runDeploymentControlPlaneCommand,
    );
    assert.equal((reenabled as any).workerId, "reenabled-worker");
    await (reenabled as any).close();
    const service = await withControlPlaneArgv(
      ["service", "--config", disabled.configPath, "--process-mode", "fully-enabled"],
      runDeploymentControlPlaneCommand,
    );
    assert.match((service as any).url, /^http:\/\/127\.0\.0\.1:/);
    await (service as any).close();
  });
});

async function exists(file: string): Promise<boolean> {
  return await fsp
    .access(file)
    .then(() => true)
    .catch(() => false);
}
