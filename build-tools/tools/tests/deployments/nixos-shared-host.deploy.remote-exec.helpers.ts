#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostDeployment } from "../../deployments/contract.ts";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
import { createNixosSharedHostInstallFixture } from "./nixos-shared-host.install.fixture.ts";
import { installFakeRemoteTransport } from "./nixos-shared-host.remote-transport.fake.ts";

export const REVIEWED_PLEOMINO_DEPLOYMENT_LABEL = "//projects/deployments/pleomino-dev:deploy";

export type RemoteExecFixture = {
  deployment: NixosSharedHostDeployment;
  env: Record<string, string>;
  artifactDir: string;
  admissionEvidencePath: string;
  profileRoot: string;
  remoteRuntimeRoot: string;
  remoteRecordsRoot: string;
  remoteStatePath: string;
};

export function pleominoDeploymentFixture(): NixosSharedHostDeployment {
  return nixosSharedHostDeploymentFixture({
    deploymentId: "pleomino-dev",
    label: REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
    component: { target: "//projects/apps/pleomino:app" },
    runtime: { appName: "pleomino", containerPort: 3000, healthPath: "/healthz" },
    lanePolicy: nixosSharedHostLanePolicyFixture({
      governance: {
        ...nixosSharedHostDeploymentFixture().lanePolicy.governance,
        branchProtections: [
          {
            stage: "dev",
            branch: "env/pleomino/dev",
            requiredChecks: [],
            fastForwardOnly: true,
            normalAdvancePrincipals: ["app:deploy-bot"],
            emergencyDirectPushPrincipals: ["team:sre-break-glass"],
          },
          {
            stage: "staging",
            branch: "env/pleomino/staging",
            requiredChecks: ["deploy/pleomino-staging"],
            fastForwardOnly: true,
            normalAdvancePrincipals: ["app:deploy-bot"],
            emergencyDirectPushPrincipals: ["team:sre-break-glass"],
          },
          {
            stage: "prod",
            branch: "env/pleomino/prod",
            requiredChecks: ["deploy/pleomino-prod"],
            fastForwardOnly: true,
            normalAdvancePrincipals: ["app:deploy-bot"],
            emergencyDirectPushPrincipals: ["team:sre-break-glass"],
          },
        ],
      },
    }),
  });
}

export function remoteExecEnv(
  env: Record<string, string>,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { ...env, IN_NIX_SHELL: "1", ...extra };
}

export async function writeArtifact(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, body, "utf8");
  }
}

async function installClientProfile(
  $: any,
  profileRoot: string,
  remoteRepoPath: string,
  remoteStatePath: string,
  remoteRuntimeRoot: string,
  remoteRecordsRoot: string,
): Promise<void> {
  await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${profileRoot} --profile mini --destination mini --remote-repo-path ${remoteRepoPath} --remote-state-path ${remoteStatePath} --remote-runtime-root ${remoteRuntimeRoot} --remote-records-root ${remoteRecordsRoot} --ssh-mode ssh`;
}

async function installReviewedPleominoTargets(tmp: string): Promise<void> {
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

async function prepareReviewedRemoteHostPaths(opts: {
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

export async function listRunRecords(recordsRoot: string): Promise<string[]> {
  const runsDir = path.join(recordsRoot, "runs");
  try {
    return (await fsp.readdir(runsDir)).sort();
  } catch {
    return [];
  }
}

export async function prepareRemoteExecFixture(opts: {
  tmp: string;
  $: any;
  artifactFiles: Record<string, string>;
  remoteRepoPath?: string;
}): Promise<RemoteExecFixture> {
  const deploymentJsonPath = path.join(opts.tmp, "reviewed-deployment.json");
  const { env } = await installFakeRemoteTransport(opts.tmp);
  const artifactDir = path.join(opts.tmp, "artifact");
  const profileRoot = path.join(opts.tmp, "profiles");
  const admissionEvidencePath = path.join(opts.tmp, "admission-evidence.json");
  const remoteRuntimeRoot = path.join(opts.tmp, "remote-runtime");
  const remoteRecordsRoot = path.join(opts.tmp, "remote-records");
  const remoteStatePath = path.join(opts.tmp, "remote-state", "platform-state.json");
  await installReviewedPleominoTargets(opts.tmp);
  const deployment = (await resolveDeploymentFromTarget(
    opts.tmp,
    REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
  )) as NixosSharedHostDeployment;
  await ensureNixosSharedHostStageBranch(opts.tmp, opts.$, deployment);
  await prepareReviewedRemoteHostPaths({
    remoteStatePath,
    remoteRuntimeRoot,
    remoteRecordsRoot,
  });
  await writeArtifact(artifactDir, opts.artifactFiles);
  await fsp.writeFile(deploymentJsonPath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
  await writeReviewedLaneAdmissionEvidenceJson({
    tmp: opts.tmp,
    $: opts.$,
    deploymentJson: deploymentJsonPath,
    deployment,
  });
  await installClientProfile(
    opts.$,
    profileRoot,
    opts.remoteRepoPath || opts.tmp,
    remoteStatePath,
    remoteRuntimeRoot,
    remoteRecordsRoot,
  );
  return {
    deployment,
    env,
    artifactDir,
    admissionEvidencePath,
    profileRoot,
    remoteRuntimeRoot,
    remoteRecordsRoot,
    remoteStatePath,
  };
}

export async function installManagedRemoteHost(
  $: any,
  tmp: string,
  mode: "managed-dropin" | "managed-manual-wire",
) {
  const fixture = await createNixosSharedHostInstallFixture({
    root: tmp,
    topology: "plain",
    withExtraImports: true,
  });
  await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts server install --server-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode ${mode}`;
  return fixture;
}
