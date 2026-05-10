#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { listDeploymentTargets } from "../../deployments/deployment-query";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

test("deployment target discovery resolves projects/deployments labels from an isolated temp repo", async () => {
  await runInTemp("verify-deployment-target-discovery-projects", async (tmp) => {
    const previousIsolation = process.env.BUCK_NESTED_ISO;
    process.env.BUCK_NESTED_ISO = inheritedBuckIsolation("verify_deployment_target_discovery");
    try {
      const appTargetsPath = path.join(tmp, "projects", "apps", "pleomino", "TARGETS");
      const sharedTargetsPath = path.join(
        tmp,
        "projects",
        "deployments",
        "pleomino-shared",
        "TARGETS",
      );
      const deployTargetsPath = path.join(
        tmp,
        "projects",
        "deployments",
        "pleomino-dev",
        "TARGETS",
      );
      await fsp.mkdir(path.dirname(appTargetsPath), { recursive: true });
      await fsp.mkdir(path.dirname(sharedTargetsPath), { recursive: true });
      await fsp.mkdir(path.dirname(deployTargetsPath), { recursive: true });
      await fsp.writeFile(
        appTargetsPath,
        [
          'load("@prelude//:rules.bzl", "genrule")',
          "",
          "genrule(",
          '    name = "app",',
          '    out = "app.txt",',
          '    cmd = "printf pleomino > $OUT",',
          '    labels = ["kind:app", "webapp:static"],',
          '    visibility = ["//projects/deployments/..."],',
          ")",
          "",
        ].join("\n"),
        "utf8",
      );
      await fsp.writeFile(
        sharedTargetsPath,
        [
          'load("//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_lane_governance", "deployment_lane_policy")',
          "",
          "deployment_lane_governance(",
          '    name = "lane_governance",',
          '    scm_backend = "github",',
          '    repository = "kiltyj/viberoots",',
          "    branch_protections = [",
          '        {"stage": "dev", "branch": "env/pleomino/dev", "required_checks": "", "fast_forward_only": "true", "normal_advance_principals": "app:deploy-bot", "emergency_direct_push_principals": "team:sre-break-glass"},',
          "    ],",
          '    visibility = ["PUBLIC"],',
          ")",
          "",
          "deployment_lane_policy(",
          '    name = "lane",',
          '    stages = ["dev"],',
          '    stage_branches = {"dev": "env/pleomino/dev"},',
          "    allowed_promotion_edges = [],",
          '    governance_policy = ":lane_governance",',
          '    visibility = ["PUBLIC"],',
          ")",
          "",
          "deployment_admission_policy(",
          '    name = "dev_release",',
          '    allowed_refs = ["env/pleomino/dev"],',
          "    required_checks = [],",
          '    visibility = ["PUBLIC"],',
          ")",
          "",
        ].join("\n"),
        "utf8",
      );
      await fsp.writeFile(
        deployTargetsPath,
        [
          'load("//build-tools/deployments:defs.bzl", "nixos_shared_host_static_webapp_deployment")',
          "",
          "nixos_shared_host_static_webapp_deployment(",
          '    name = "deploy",',
          '    component = "//projects/apps/pleomino:app",',
          '    app_name = "pleomino",',
          "    container_port = 3000,",
          '    lane_policy = "//projects/deployments/pleomino-shared:lane",',
          '    environment_stage = "dev",',
          '    admission_policy = "//projects/deployments/pleomino-shared:dev_release",',
          ")",
          "",
        ].join("\n"),
        "utf8",
      );

      const targets = await listDeploymentTargets(tmp);
      assert.deepEqual(targets, ["//projects/deployments/pleomino-dev:deploy"]);
    } finally {
      if (previousIsolation === undefined) delete process.env.BUCK_NESTED_ISO;
      else process.env.BUCK_NESTED_ISO = previousIsolation;
    }
  });
});
