#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export async function installClientProfile(
  $: any,
  profileRoot: string,
  remoteRepoPath: string,
  remoteStatePath: string,
  remoteRuntimeRoot: string,
  remoteRecordsRoot: string,
  controlPlaneUrl: string = "http://127.0.0.1:65535",
): Promise<void> {
  await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${profileRoot} --profile mini --destination mini --remote-repo-path ${remoteRepoPath} --remote-state-path ${remoteStatePath} --remote-runtime-root ${remoteRuntimeRoot} --remote-records-root ${remoteRecordsRoot} --ssh-mode ssh --control-plane-url ${controlPlaneUrl}`;
}

export async function installReviewedPleominoTargets(tmp: string): Promise<void> {
  const appTargetsPath = path.join(tmp, "projects", "apps", "pleomino", "TARGETS");
  const deployTargetsPath = path.join(tmp, "projects", "deployments", "pleomino-dev", "TARGETS");
  const sharedTargetsPath = path.join(tmp, "projects", "deployments", "pleomino-shared", "TARGETS");
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
      '    cmd = "printf pleomino > $OUT",',
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
      '    repository = "kiltyj/bucknix-fresh",',
      "    branch_protections = [",
      '        {"stage": "dev", "branch": "env/pleomino/dev", "required_checks": "", "fast_forward_only": "true", "normal_advance_principals": "app:deploy-bot", "emergency_direct_push_principals": "team:sre-break-glass"},',
      '        {"stage": "staging", "branch": "env/pleomino/staging", "required_checks": "deploy/pleomino-staging", "fast_forward_only": "true", "normal_advance_principals": "app:deploy-bot", "emergency_direct_push_principals": "team:sre-break-glass"},',
      '        {"stage": "prod", "branch": "env/pleomino/prod", "required_checks": "deploy/pleomino-prod", "fast_forward_only": "true", "normal_advance_principals": "app:deploy-bot", "emergency_direct_push_principals": "team:sre-break-glass"},',
      "    ],",
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_lane_policy(",
      '    name = "lane",',
      '    stages = ["dev", "staging", "prod"],',
      '    stage_branches = {"dev": "env/pleomino/dev", "staging": "env/pleomino/staging", "prod": "env/pleomino/prod"},',
      '    allowed_promotion_edges = ["dev->staging", "staging->prod"],',
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
      '    lane_policy = "//projects/deployments/pleomino-shared:lane",',
      '    environment_stage = "dev",',
      '    admission_policy = "//projects/deployments/pleomino-shared:dev_release",',
      '    app_name = "pleomino",',
      "    container_port = 3000,",
      '    health_path = "/healthz",',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
}

export async function prepareReviewedRemoteHostPaths(opts: {
  remoteStatePath: string;
  remoteRuntimeRoot: string;
  remoteRecordsRoot: string;
}): Promise<void> {
  await Promise.all([
    fsp.mkdir(path.dirname(opts.remoteStatePath), { recursive: true }),
    fsp.mkdir(opts.remoteRuntimeRoot, { recursive: true }),
    fsp.mkdir(opts.remoteRecordsRoot, { recursive: true }),
  ]);
}
