#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { listDeploymentsForCli } from "../../deployments/deploy-front-door.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";
import { s3StaticDeploymentFixture } from "./s3-static.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";

async function writeDeploymentJson(filePath: string, deployment: unknown) {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

async function writeTempListedDeploymentWorkspace(tmp: string): Promise<void> {
  const appTargetsPath = path.join(tmp, "sandbox", "apps", "demo", "TARGETS");
  const sharedTargetsPath = path.join(tmp, "sandbox", "deployments", "shared", "TARGETS");
  const deployTargetsPath = path.join(tmp, "sandbox", "deployments", "demo-dev", "TARGETS");
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
      'load("//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_lane_governance", "deployment_lane_policy")',
      "",
      "deployment_lane_governance(",
      '    name = "lane_governance",',
      '    scm_backend = "github",',
      '    repository = "example/sandbox",',
      "    branch_protections = [",
      '        {"stage": "dev", "branch": "env/demo/dev", "required_checks": "deploy/demo-dev", "fast_forward_only": "true", "normal_advance_principals": "app:deploy-bot", "emergency_direct_push_principals": "team:sre-break-glass"},',
      "    ],",
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_lane_policy(",
      '    name = "lane",',
      '    stages = ["dev"],',
      '    stage_branches = {"dev": "env/demo/dev"},',
      "    allowed_promotion_edges = [],",
      '    governance_policy = ":lane_governance",',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_admission_policy(",
      '    name = "dev_release",',
      '    allowed_refs = ["env/demo/dev"],',
      '    required_checks = ["deploy/demo-dev"],',
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
      '    component = "//sandbox/apps/demo:app",',
      '    lane_policy = "//sandbox/deployments/shared:lane",',
      '    environment_stage = "dev",',
      '    admission_policy = "//sandbox/deployments/shared:dev_release",',
      '    app_name = "demo",',
      "    container_port = 3000,",
      '    health_path = "/healthz",',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
}

test("deploy --list returns the stable repo-level discovery document from scaffolded targets", async () => {
  await runInTemp("deploy-list-contract", async (tmp) => {
    await writeTempListedDeploymentWorkspace(tmp);
    const listed = await listDeploymentsForCli(tmp);
    assert.equal(listed.schemaVersion, "deploy-list@1");
    assert.ok(
      listed.deployments.some((entry) => entry.label === "//sandbox/deployments/demo-dev:deploy"),
    );
  });
});

test("deploy --validate-only returns validation output without creating local records", async () => {
  await runInTemp("deploy-validate-only-contract", async (tmp, $) => {
    const deploymentJson = path.join(tmp, "deployment.json");
    const recordsRoot = path.join(tmp, "records");
    await writeDeploymentJson(deploymentJson, nixosSharedHostDeploymentFixture());
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --validate-only`;
    const payload = JSON.parse(String(result.stdout));
    assert.equal(payload.schemaVersion, "deploy-validate@1");
    assert.equal(payload.valid, true);
    assert.equal(
      await fsp
        .access(recordsRoot)
        .then(() => "present")
        .catch(() => "missing"),
      "missing",
    );
  });
});

test("deploy front door rejects cloudflare-pages --provision-only", async () => {
  await runInTemp("deploy-cloudflare-provision-only-guard", async (tmp, $) => {
    const deploymentJson = path.join(tmp, "deployment.json");
    await writeDeploymentJson(deploymentJson, cloudflarePagesDeploymentFixture());
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --provision-only`,
      /does not support --provision-only/,
    );
  });
});

test("deploy front door rejects s3-static --provision-only", async () => {
  await runInTemp("deploy-s3-static-provision-only-guard", async (tmp, $) => {
    const deploymentJson = path.join(tmp, "deployment.json");
    await writeDeploymentJson(deploymentJson, s3StaticDeploymentFixture());
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --provision-only`,
      /provisions as part of deploy/,
    );
  });
});

test("deploy front door rejects kubernetes mutation flow until runtime is implemented", async () => {
  await runInTemp("deploy-kubernetes-runtime-guard", async (tmp, $) => {
    const deploymentJson = path.join(tmp, "deployment.json");
    await writeDeploymentJson(deploymentJson, kubernetesDeploymentFixture());
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson}`,
      /kubernetes deploy execution is not implemented yet/,
    );
  });
});
