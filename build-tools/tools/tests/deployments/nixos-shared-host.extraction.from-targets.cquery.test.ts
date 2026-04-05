#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes.ts";
import { extractNixosSharedHostDeployments } from "../../deployments/contract.ts";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers.ts";

const ATTRS = [
  "name",
  "rule_type",
  "buck.type",
  "provider",
  "component",
  "component_kind",
  "components",
  "publisher",
  "provisioner",
  "protection_class",
  "lane_policy",
  "environment_stage",
  "admission_policy",
  "rollout_policy",
  "rollout_steps",
  "app_name",
  "container_port",
  "health_path",
  "target_group",
  "prerequisites",
  "stages",
  "stage_branches",
  "allowed_promotion_edges",
  "artifact_reuse_mode",
  "allowed_refs",
  "required_checks",
  "required_approvals",
  "retry_branch_policy",
  "artifact_attestation_mode",
  "labels",
];

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
    await fsp.mkdir(path.dirname(appTargetsPath), { recursive: true });
    await fsp.mkdir(path.dirname(deployTargetsPath), { recursive: true });
    await fsp.mkdir(path.dirname(sharedTargetsPath), { recursive: true });
    await fsp.writeFile(
      appTargetsPath,
      [
        'load("@prelude//:rules.bzl", "genrule")',
        "",
        "genrule(",
        '    name = "app",',
        '    out = "app.txt",',
        '    cmd = "printf demo > $OUT",',
        '    labels = ["kind:app", "webapp:static"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      sharedTargetsPath,
      [
        'load("//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_lane_policy")',
        "",
        "deployment_lane_policy(",
        '    name = "lane",',
        '    stages = ["dev", "staging", "prod"],',
        '    stage_branches = {"dev": "env/pleomino/dev", "staging": "env/pleomino/staging", "prod": "env/pleomino/prod"},',
        '    allowed_promotion_edges = ["dev->staging", "staging->prod"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
        "deployment_admission_policy(",
        '    name = "dev_release",',
        '    allowed_refs = ["env/pleomino/dev"],',
        '    required_checks = ["deploy/pleomino-dev"],',
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
        '    component = "//projects/apps/demoapp:app",',
        '    lane_policy = "//projects/deployments/pleomino-shared:lane",',
        '    environment_stage = "dev",',
        '    admission_policy = "//projects/deployments/pleomino-shared:dev_release",',
        '    app_name = "demoapp",',
        "    container_port = 3000,",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const attrFlags = ATTRS.flatMap((attr) => ["--output-attribute", attr]);
    const query =
      "set(//projects/deployments/demoapp-dev:deploy //projects/apps/demoapp:app //projects/deployments/pleomino-shared:lane //projects/deployments/pleomino-shared:dev_release)";
    const cquery = await _$({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
      },
    })`buck2 --isolation-dir ${inheritedBuckIsolation("deployment-cquery")} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`.quiet();
    const merged = JSON.parse(String(cquery.stdout || "")) as Record<string, any>;
    const { deployments, errors } = extractNixosSharedHostDeployments(nodesFromCqueryJson(merged));
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
    await fsp.mkdir(path.dirname(appTargetsPath), { recursive: true });
    await fsp.mkdir(path.dirname(apiTargetsPath), { recursive: true });
    await fsp.mkdir(path.dirname(deployTargetsPath), { recursive: true });
    await fsp.mkdir(path.dirname(sharedTargetsPath), { recursive: true });
    for (const [targetPath, name] of [
      [appTargetsPath, "app"],
      [apiTargetsPath, "api"],
    ] as const) {
      await fsp.writeFile(
        targetPath,
        [
          'load("@prelude//:rules.bzl", "genrule")',
          "",
          "genrule(",
          `    name = "${name}",`,
          `    out = "${name}.txt",`,
          `    cmd = "printf ${name} > $OUT",`,
          '    labels = ["kind:app", "webapp:static"],',
          '    visibility = ["PUBLIC"],',
          ")",
          "",
        ].join("\n"),
        "utf8",
      );
    }
    await fsp.writeFile(
      sharedTargetsPath,
      [
        'load("//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_lane_policy")',
        "",
        "deployment_lane_policy(",
        '    name = "lane",',
        '    stages = ["dev", "staging", "prod"],',
        '    stage_branches = {"dev": "env/pleomino/dev", "staging": "env/pleomino/staging", "prod": "env/pleomino/prod"},',
        '    allowed_promotion_edges = ["dev->staging", "staging->prod"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
        "deployment_admission_policy(",
        '    name = "dev_release",',
        '    allowed_refs = ["env/pleomino/dev"],',
        '    required_checks = ["deploy/pleomino-dev"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
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

    const attrFlags = ATTRS.flatMap((attr) => ["--output-attribute", attr]);
    const query =
      "set(//projects/deployments/demo-stack-dev:deploy //projects/apps/demoapp:app //projects/apps/demoapi:api //projects/deployments/pleomino-shared:lane //projects/deployments/pleomino-shared:dev_release)";
    const cquery = await _$({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
      },
    })`buck2 --isolation-dir ${inheritedBuckIsolation("deployment-cquery-multi")} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`.quiet();
    const merged = JSON.parse(String(cquery.stdout || "")) as Record<string, any>;
    const { deployments, errors } = extractNixosSharedHostDeployments(nodesFromCqueryJson(merged));
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
