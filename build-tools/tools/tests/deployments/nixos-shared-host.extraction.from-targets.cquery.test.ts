#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { extractNixosSharedHostDeployments } from "../../deployments/contract.ts";
import {
  ensureParentDir,
  runDeploymentCquery,
  writeSharedLaneTargets,
  writeStaticWebappTarget,
} from "./nixos-shared-host.extraction.from-targets.helpers.ts";
import { runInTemp } from "../lib/test-helpers.ts";

test("nixos-shared-host deployment extraction reads canonical metadata from TARGETS via cquery", async () => {
  await runInTemp("deployment-cquery-extraction", async (tmp, _$) => {
    const appTargetsPath = path.join(tmp, "projects", "apps", "demoapp", "TARGETS");
    const deployTargetsPath = path.join(tmp, "projects", "deployments", "demoapp-dev", "TARGETS");
    const sharedTargetsPath = path.join(
      tmp,
      "projects",
      "deployments",
      "pleomino-shared",
      "TARGETS",
    );
    await writeStaticWebappTarget(appTargetsPath, "app");
    await writeSharedLaneTargets(sharedTargetsPath);
    await ensureParentDir(deployTargetsPath);
    await fsp.writeFile(
      deployTargetsPath,
      [
        'load("//build-tools/deployments:defs.bzl", "nixos_shared_host_static_webapp_deployment")',
        "",
        "nixos_shared_host_static_webapp_deployment(",
        '    name = "deploy",',
        '    component = "//projects/apps/demoapp:app",',
        '    lane_policy = "//projects/deployments/pleomino-shared:lane",',
        '    environment_stage = "dev",',
        '    admission_policy = "//projects/deployments/pleomino-shared:dev_release",',
        "    secret_requirements = [],",
        "    runtime_config_requirements = [],",
        '    app_name = "demoapp",',
        "    container_port = 3000,",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const nodes = await runDeploymentCquery(tmp, _$, "deployment-cquery", [
      "//projects/deployments/demoapp-dev:deploy",
      "//projects/apps/demoapp:app",
      "//projects/deployments/pleomino-shared:lane",
      "//projects/deployments/pleomino-shared:lane_governance",
      "//projects/deployments/pleomino-shared:dev_release",
    ]);
    const { deployments, errors } = extractNixosSharedHostDeployments(nodes);
    assert.deepEqual(errors, []);
    assert.equal(deployments.length, 1);
    assert.equal(deployments[0]?.label, "//projects/deployments/demoapp-dev:deploy");
    assert.equal(deployments[0]?.name, "deploy");
    assert.equal(deployments[0]?.lanePolicyRef, "//projects/deployments/pleomino-shared:lane");
    assert.equal(
      deployments[0]?.admissionPolicyRef,
      "//projects/deployments/pleomino-shared:dev_release",
    );
    assert.equal(deployments[0]?.environmentStage, "dev");
    assert.equal(deployments[0]?.runtime.appName, "demoapp");
    assert.equal(deployments[0]?.runtime.containerPort, 3000);
    assert.deepEqual(deployments[0]?.prerequisites, []);
    assert.equal(deployments[0]?.providerTarget.hostname, "demoapp.apps.kilty.io");
    assert.equal(
      deployments[0]?.providerTarget.sharedDevTargetIdentity,
      "nixos-shared-host:default:demoapp",
    );
  });
});

test("nixos-shared-host multi-component extraction reads rollout policy and component metadata", async () => {
  await runInTemp("deployment-cquery-multi-component", async (tmp, _$) => {
    const appTargetsPath = path.join(tmp, "projects", "apps", "demoapp", "TARGETS");
    const apiTargetsPath = path.join(tmp, "projects", "apps", "demoapi", "TARGETS");
    const deployTargetsPath = path.join(
      tmp,
      "projects",
      "deployments",
      "demo-stack-dev",
      "TARGETS",
    );
    const sharedTargetsPath = path.join(
      tmp,
      "projects",
      "deployments",
      "pleomino-shared",
      "TARGETS",
    );
    for (const [targetPath, name] of [
      [appTargetsPath, "app"],
      [apiTargetsPath, "api"],
    ] as const) {
      await writeStaticWebappTarget(targetPath, name);
    }
    await writeSharedLaneTargets(sharedTargetsPath);
    await ensureParentDir(deployTargetsPath);
    await fsp.writeFile(
      deployTargetsPath,
      [
        'load("//build-tools/deployments:defs.bzl", "nixos_shared_host_multi_static_webapp_deployment")',
        "",
        "nixos_shared_host_multi_static_webapp_deployment(",
        '    name = "deploy",',
        '    lane_policy = "//projects/deployments/pleomino-shared:lane",',
        '    environment_stage = "dev",',
        '    admission_policy = "//projects/deployments/pleomino-shared:dev_release",',
        "    secret_requirements = [],",
        "    runtime_config_requirements = [],",
        "    components = [",
        '        {"id": "frontend", "target": "//projects/apps/demoapp:app", "app_name": "demoapp", "container_port": 3000},',
        '        {"id": "api", "target": "//projects/apps/demoapi:api", "app_name": "demoapi", "container_port": 3001},',
        "    ],",
        '    rollout_policy = {"mode": "ordered_best_effort", "abort": "stop_on_first_failure", "smoke": "final_only", "steps": ["frontend", "api"]},',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const nodes = await runDeploymentCquery(tmp, _$, "deployment-cquery-multi", [
      "//projects/deployments/demo-stack-dev:deploy",
      "//projects/apps/demoapp:app",
      "//projects/apps/demoapi:api",
      "//projects/deployments/pleomino-shared:lane",
      "//projects/deployments/pleomino-shared:lane_governance",
      "//projects/deployments/pleomino-shared:dev_release",
    ]);
    const { deployments, errors } = extractNixosSharedHostDeployments(nodes);
    assert.deepEqual(errors, []);
    assert.equal(deployments.length, 1);
    assert.equal(deployments[0]?.components.length, 2);
    assert.equal(deployments[0]?.components[0]?.id, "frontend");
    assert.equal(deployments[0]?.components[1]?.id, "api");
    assert.equal(deployments[0]?.rolloutPolicy?.mode, "ordered_best_effort");
    assert.deepEqual(deployments[0]?.rolloutPolicy?.steps, ["frontend", "api"]);
    assert.equal(
      deployments[0]?.providerTarget.deploymentTargetIdentity,
      "nixos-shared-host:default:{demoapi,demoapp}",
    );
  });
});
