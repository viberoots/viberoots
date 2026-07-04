#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { viberootsToolScript } from "./deployment-command";

export async function installClientProfile(
  $: any,
  profileRoot: string,
  remoteRepoPath: string,
  remoteStatePath: string,
  remoteRuntimeRoot: string,
  remoteRecordsRoot: string,
  controlPlaneUrl: string = "http://127.0.0.1:65535",
): Promise<void> {
  const installScript = viberootsToolScript(
    "build-tools/tools/deployments/nixos-shared-host-install.ts",
  );
  await $`zx-wrapper ${installScript} client install --output-root ${profileRoot} --profile mini --destination mini --remote-repo-path ${remoteRepoPath} --remote-state-path ${remoteStatePath} --remote-runtime-root ${remoteRuntimeRoot} --remote-records-root ${remoteRecordsRoot} --ssh-mode ssh --control-plane-url ${controlPlaneUrl}`;
}

export async function installHarnessClientProfile(
  $: any,
  tmp: string,
  controlPlaneUrl: string,
): Promise<string> {
  const profileRoot = path.join(tmp, "profiles");
  await installClientProfile(
    $,
    profileRoot,
    "/srv/viberoots",
    path.join(tmp, "remote-state.json"),
    path.join(tmp, "remote-runtime"),
    path.join(tmp, "remote-records"),
    controlPlaneUrl,
  );
  return profileRoot;
}

export async function installReviewedSampleWebappTargets(tmp: string): Promise<void> {
  const appTargetsPath = path.join(tmp, "projects", "apps", "sample-webapp", "TARGETS");
  const deployTargetsPath = path.join(
    tmp,
    "projects",
    "deployments",
    "sample-webapp",
    "dev",
    "TARGETS",
  );
  const sharedTargetsPath = path.join(
    tmp,
    "projects",
    "deployments",
    "sample-webapp",
    "shared",
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
      '    cmd = "printf sample-webapp > $OUT",',
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
      'load("@viberoots//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_lane_governance", "deployment_lane_policy")',
      "",
      "deployment_lane_governance(",
      '    name = "lane_governance",',
      '    scm_backend = "github",',
      '    repository = "viberoots/viberoots",',
      "    source_ref_policies = [",
      '        {"stage": "dev", "allowed_refs": "main", "required_checks": ""},',
      '        {"stage": "staging", "allowed_refs": "main,refs/tags/release/*", "required_checks": "deploy/sample-webapp-staging"},',
      '        {"stage": "prod", "allowed_refs": "refs/tags/release/*", "required_checks": "deploy/sample-webapp-prod"},',
      "    ],",
      '    trusted_reporter_identities = ["app:deploy-bot"],',
      "    required_approval_boundaries = [",
      '        {"stage": "prod", "required_approvals": "release-owner"},',
      "    ],",
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_lane_policy(",
      '    name = "lane",',
      '    stages = ["dev", "staging", "prod"],',
      '    source_ref_policy = {"dev": "main", "staging": "main", "prod": "refs/tags/release/*"},',
      '    allowed_promotion_edges = ["dev->staging", "staging->prod"],',
      '    artifact_reuse_mode = "same_artifact",',
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
      "deployment_admission_policy(",
      '    name = "staging_release",',
      '    allowed_refs = ["main", "refs/tags/release/*"],',
      '    required_checks = ["deploy/sample-webapp-staging"],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_admission_policy(",
      '    name = "prod_release",',
      '    allowed_refs = ["refs/tags/release/*"],',
      '    required_checks = ["deploy/sample-webapp-prod"],',
      '    required_approvals = ["release-owner"],',
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
      '    component = "//projects/apps/sample-webapp:app",',
      '    lane_policy = "//projects/deployments/sample-webapp/shared:lane",',
      '    environment_stage = "dev",',
      '    admission_policy = "//projects/deployments/sample-webapp/shared:dev_release",',
      '    app_name = "sample-webapp",',
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
