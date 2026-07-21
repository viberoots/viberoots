#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { listDeploymentTargets } from "../../deployments/deployment-query";
import { runInTemp } from "../lib/test-helpers";
import { reconcileSyntheticGeneratedGraph } from "../lib/generated-graph.fixture";

test("deployment target discovery resolves projects/deployments labels from an isolated temp repo", async () => {
  await runInTemp("verify-deployment-target-discovery-projects", async (tmp) => {
    const isolationKeys = [
      "BUCK_ISOLATION_DIR",
      "BUCK_NESTED_ISO",
      "BUCK_ISOLATION_DIR_EXPORTER",
    ] as const;
    const previousIsolation = Object.fromEntries(
      isolationKeys.map((key) => [key, process.env[key]]),
    );
    try {
      const appTargetsPath = path.join(tmp, "projects", "apps", "sample-app", "TARGETS");
      const sharedTargetsPath = path.join(
        tmp,
        "projects",
        "deployments",
        "sample",
        "shared",
        "TARGETS",
      );
      const deployTargetsPath = path.join(
        tmp,
        "projects",
        "deployments",
        "sample",
        "dev",
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
          '    cmd = "printf sample > $OUT",',
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
          'load("@viberoots//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_lane_governance", "deployment_lane_policy")',
          "",
          "deployment_lane_governance(",
          '    name = "lane_governance",',
          '    scm_backend = "github",',
          '    repository = "viberoots/viberoots",',
          "    source_ref_policies = [",
          '        {"stage": "dev", "allowed_refs": "main", "required_checks": ""},',
          "    ],",
          '    trusted_reporter_identities = ["app:deploy-bot"],',
          '    required_approval_boundaries = [{"stage": "prod", "required_approvals": "release-owner"}],',
          '    visibility = ["PUBLIC"],',
          ")",
          "",
          "deployment_lane_policy(",
          '    name = "lane",',
          '    stages = ["dev"],',
          '    source_ref_policy = {"dev": "main"},',
          "    allowed_promotion_edges = [],",
          '    governance_policy = ":lane_governance",',
          '    visibility = ["PUBLIC"],',
          ")",
          "",
          "deployment_admission_policy(",
          '    name = "dev_release",',
          '    allowed_refs = ["main"],',
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
          'load("@viberoots//build-tools/deployments:defs.bzl", "nixos_shared_host_static_webapp_deployment")',
          "",
          "nixos_shared_host_static_webapp_deployment(",
          '    name = "deploy",',
          '    component = "//projects/apps/sample-app:app",',
          '    app_name = "sample-app",',
          "    container_port = 3000,",
          '    lane_policy = "//projects/deployments/sample/shared:lane",',
          '    environment_stage = "dev",',
          '    admission_policy = "//projects/deployments/sample/shared:dev_release",',
          ")",
          "",
        ].join("\n"),
        "utf8",
      );
      const graphEnv = await reconcileSyntheticGeneratedGraph(tmp);
      for (const key of isolationKeys) process.env[key] = graphEnv[key];

      const targets = await listDeploymentTargets(tmp);
      assert.deepEqual(targets, ["//projects/deployments/sample/dev:deploy"]);
    } finally {
      for (const key of isolationKeys) {
        const previous = previousIsolation[key];
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
    }
  });
});
