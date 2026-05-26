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
