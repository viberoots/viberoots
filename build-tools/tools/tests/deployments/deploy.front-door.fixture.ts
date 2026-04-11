#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export async function writeTempListedDeploymentWorkspace(tmp: string): Promise<void> {
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

export async function writeTempCloudflareValidationWorkspace(
  tmp: string,
  opts: { appLabels?: string[]; wranglerConfig?: string } = {},
): Promise<void> {
  const appTargetsPath = path.join(tmp, "sandbox", "apps", "demo", "TARGETS");
  const sharedTargetsPath = path.join(tmp, "sandbox", "deployments", "shared", "TARGETS");
  const deployTargetsPath = path.join(tmp, "sandbox", "deployments", "demo-staging", "TARGETS");
  const wranglerPath = path.join(tmp, "sandbox", "deployments", "demo-staging", "wrangler.jsonc");
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
      `    labels = [${(opts.appLabels || ["kind:app", "webapp:static"])
        .map((entry) => `"${entry}"`)
        .join(", ")}],`,
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
      '        {"stage": "staging", "branch": "env/demo/staging", "required_checks": "deploy/demo-staging", "fast_forward_only": "true", "normal_advance_principals": "app:deploy-bot", "emergency_direct_push_principals": "team:sre-break-glass"},',
      "    ],",
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_lane_policy(",
      '    name = "lane",',
      '    stages = ["staging"],',
      '    stage_branches = {"staging": "env/demo/staging"},',
      "    allowed_promotion_edges = [],",
      '    governance_policy = ":lane_governance",',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_admission_policy(",
      '    name = "staging_release",',
      '    allowed_refs = ["env/demo/staging"],',
      '    required_checks = ["deploy/demo-staging"],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    deployTargetsPath,
    [
      'load("//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment")',
      "",
      "cloudflare_pages_static_webapp_deployment(",
      '    name = "deploy",',
      '    component = "//sandbox/apps/demo:app",',
      '    account = "web-platform-staging",',
      '    project = "demo-staging-pages",',
      '    lane_policy = "//sandbox/deployments/shared:lane",',
      '    environment_stage = "staging",',
      '    admission_policy = "//sandbox/deployments/shared:staging_release",',
      '    protection_class = "shared_nonprod",',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    wranglerPath,
    opts.wranglerConfig ||
      '{ "name": "demo-staging-pages", "account_id": "web-platform-staging" }\n',
    "utf8",
  );
}
