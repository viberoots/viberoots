#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export async function writeTempReadinessFrontDoorWorkspace(
  tmp: string,
  opts: { crossAppDependency?: boolean } = {},
): Promise<void> {
  await writeAppTargets(tmp, opts);
  await writeSharedTargets(tmp);
  await writeDeploymentTarget(tmp);
}

async function writeAppTargets(tmp: string, opts: { crossAppDependency?: boolean }) {
  const appTargetsPath = path.join(tmp, "projects/apps/console/TARGETS");
  const adminTargetsPath = path.join(tmp, "projects/apps/admin/TARGETS");
  await fsp.mkdir(path.dirname(appTargetsPath), { recursive: true });
  await fsp.mkdir(path.dirname(adminTargetsPath), { recursive: true });
  await fsp.writeFile(
    adminTargetsPath,
    [
      'load("@prelude//:rules.bzl", "genrule")',
      "",
      "genrule(",
      '    name = "app",',
      '    out = "admin.txt",',
      '    cmd = "printf admin > $OUT",',
      '    labels = ["kind:app", "webapp:static"],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(appTargetsPath, appTargetContents(opts.crossAppDependency), "utf8");
}

function appTargetContents(crossAppDependency = false) {
  return [
    'load("@prelude//:rules.bzl", "genrule")',
    "",
    "genrule(",
    '    name = "app",',
    '    out = "console.txt",',
    '    cmd = "printf console > $OUT",',
    ...(crossAppDependency ? ['    srcs = ["//projects/apps/admin:app"],'] : []),
    '    labels = ["kind:app", "webapp:static"],',
    '    visibility = ["PUBLIC"],',
    ")",
    "",
  ].join("\n");
}

async function writeSharedTargets(tmp: string) {
  const sharedTargetsPath = path.join(tmp, "projects/deployments/shared/TARGETS");
  await fsp.mkdir(path.dirname(sharedTargetsPath), { recursive: true });
  await fsp.writeFile(
    sharedTargetsPath,
    [
      'load("//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_lane_governance", "deployment_lane_policy")',
      "",
      "deployment_lane_governance(",
      '    name = "lane_governance",',
      '    scm_backend = "github",',
      '    repository = "example/console",',
      '    branch_protections = [{"stage": "staging", "branch": "env/console/staging", "required_checks": "deploy/console-staging", "fast_forward_only": "true", "normal_advance_principals": "app:deploy-bot", "emergency_direct_push_principals": "team:sre-break-glass"}],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_lane_policy(",
      '    name = "lane",',
      '    stages = ["staging"],',
      '    stage_branches = {"staging": "env/console/staging"},',
      "    allowed_promotion_edges = [],",
      '    governance_policy = ":lane_governance",',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_admission_policy(",
      '    name = "staging_release",',
      '    allowed_refs = ["env/console/staging"],',
      '    required_checks = ["deploy/console-staging"],',
      "    readiness_gates = [",
      '        {"name": "live/ragie", "type": "ragie_acl_semantics", "required_for": "deploy"},',
      "    ],",
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function writeDeploymentTarget(tmp: string) {
  const deployTargetsPath = path.join(tmp, "projects/deployments/console-staging/TARGETS");
  const wranglerPath = path.join(tmp, "projects/deployments/console-staging/wrangler.jsonc");
  await fsp.mkdir(path.dirname(deployTargetsPath), { recursive: true });
  await fsp.writeFile(
    deployTargetsPath,
    [
      'load("//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment")',
      "",
      "cloudflare_pages_static_webapp_deployment(",
      '    name = "deploy",',
      '    component = "//projects/apps/console:app",',
      '    account = "web-platform-staging",',
      '    project = "console-staging-pages",',
      '    lane_policy = "//projects/deployments/shared:lane",',
      '    environment_stage = "staging",',
      '    admission_policy = "//projects/deployments/shared:staging_release",',
      '    protection_class = "shared_nonprod",',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    wranglerPath,
    '{ "name": "console-staging-pages", "account_id": "web-platform-staging" }\n',
    "utf8",
  );
}
