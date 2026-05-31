#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runDeploymentControlPlaneCommand } from "../../deployments/deployment-control-plane";
import { runInScratchTemp } from "../lib/test-helpers";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";
import { withRawControlPlaneArgv, writeBundle } from "./control-plane-credential-staging.helpers";

test("credential staging and rotation CLI modes are real entrypoints", async () => {
  await runInScratchTemp("credential-staging-entrypoints", async (tmp) => {
    await writeBundle(tmp);
    await withControlPlaneArgv(
      [
        "credential-staging",
        "--bundle-dir",
        tmp,
        "--out",
        path.join(tmp, "credential-staging.json"),
      ],
      runDeploymentControlPlaneCommand,
    );
    await withControlPlaneArgv(
      [
        "credential-rotation",
        "--bundle-dir",
        tmp,
        "--out",
        path.join(tmp, "credential-rotation.json"),
      ],
      runDeploymentControlPlaneCommand,
    );
    await fsp.access(path.join(tmp, "credential-staging.json"));
    await fsp.access(path.join(tmp, "credential-rotation.json"));
    await withRawControlPlaneArgv(
      [
        "--bundle-dir",
        tmp,
        "credential-staging",
        "--out",
        path.join(tmp, "credential-staging-before.json"),
      ],
      runDeploymentControlPlaneCommand,
    );
    await fsp.access(path.join(tmp, "credential-staging-before.json"));
  });
});
