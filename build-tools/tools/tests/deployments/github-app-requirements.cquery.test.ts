#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { extractNixosSharedHostDeployments } from "../../deployments/contract";
import {
  ensureParentDir,
  runDeploymentCquery,
  writeSharedLaneTargets,
  writeStaticWebappTarget,
} from "./nixos-shared-host.extraction.from-targets.helpers";
import { runInTemp } from "../lib/test-helpers";

test("github_app_requirements emits profile, secrets, and runtime config", async () => {
  await runInTemp("github-app-requirements-cquery", async (tmp, _$) => {
    const appTargetsPath = path.join(tmp, "projects", "apps", "demoapp", "TARGETS");
    const deployTargetsPath = path.join(tmp, "projects", "deployments", "demoapp-dev", "TARGETS");
    const sharedTargetsPath = path.join(
      tmp,
      "projects",
      "deployments",
      "pleomino",
      "shared",
      "TARGETS",
    );
    await writeStaticWebappTarget(appTargetsPath, "app");
    await writeSharedLaneTargets(sharedTargetsPath);
    await ensureParentDir(deployTargetsPath);
    await fsp.writeFile(
      deployTargetsPath,
      [
        'load("@viberoots//build-tools/deployments:defs.bzl", "github_app_requirements", "nixos_shared_host_static_webapp_deployment")',
        "",
        "nixos_shared_host_static_webapp_deployment(",
        '    name = "deploy",',
        '    component = "//projects/apps/demoapp:app",',
        '    lane_policy = "//projects/deployments/pleomino/shared:lane",',
        '    environment_stage = "dev",',
        '    admission_policy = "//projects/deployments/pleomino/shared:dev_release",',
        '    app_name = "demoapp",',
        "    container_port = 3000,",
        '    **github_app_requirements("demoapp-dev", webhooks = True, webhook_config = True)',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const nodes = await runDeploymentCquery(tmp, _$, "github-app-requirements", [
      "//projects/deployments/demoapp-dev:deploy",
      "//projects/apps/demoapp:app",
      "//projects/deployments/pleomino/shared:lane",
      "//projects/deployments/pleomino/shared:defaults",
      "//projects/deployments/pleomino/shared:lane_governance",
      "//projects/deployments/pleomino/shared:dev_release",
    ]);
    const { deployments, errors } = extractNixosSharedHostDeployments(nodes);
    assert.deepEqual(errors, []);
    const deployment = deployments[0];
    assert.deepEqual(deployment?.externalRequirementProfiles, ["github_app"]);
    assert.deepEqual(deployment?.secretRequirements.map((entry) => entry.name).sort(), [
      "github_app_private_key",
      "github_webhook_secret",
    ]);
    assert.deepEqual(deployment?.runtimeConfigRequirements.map((entry) => entry.name).sort(), [
      "github_app_id",
      "github_webhook_url",
    ]);
  });
});
