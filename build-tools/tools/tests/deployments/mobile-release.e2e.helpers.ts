#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { AppStoreConnectDeployment, GooglePlayDeployment } from "../../deployments/contract";
import type { DeploymentRolloutPolicy } from "../../deployments/deployment-rollout";
import { nixosSharedHostLaneGovernanceFixture } from "./deployment-lane-governance.fixture";
import { nixosSharedHostLanePolicyFixture } from "./nixos-shared-host.fixture";

type MobileDeployment = AppStoreConnectDeployment | GooglePlayDeployment;

export async function writeMobileArtifact(filePath: string, contents: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, contents, "utf8");
}

export async function writePublisherConfig(
  workspaceRoot: string,
  deploymentId: string,
  fileName: string,
  config: unknown,
): Promise<void> {
  const packageDir = path.join(workspaceRoot, "projects", "deployments", deploymentId);
  await fsp.mkdir(packageDir, { recursive: true });
  await fsp.writeFile(
    path.join(packageDir, fileName),
    JSON.stringify(config, null, 2) + "\n",
    "utf8",
  );
}

export function mobileReviewedLanePolicy() {
  return nixosSharedHostLanePolicyFixture({
    governance: nixosSharedHostLaneGovernanceFixture({
      branchProtections: [
        stageBranchProtection("dev", "env/mobile/dev"),
        stageBranchProtection("staging", "env/mobile/staging"),
        stageBranchProtection("prod", "env/mobile/prod"),
      ],
    }),
    stageBranches: {
      dev: "env/mobile/dev",
      staging: "env/mobile/staging",
      prod: "env/mobile/prod",
    },
  });
}

export async function installMobileSharedTargets(opts: {
  workspaceRoot: string;
  appTargetLabel: string;
  appArtifactName: string;
  appArtifactMarker: string;
  deployments: MobileDeployment[];
}): Promise<void> {
  const [primary] = opts.deployments;
  if (!primary) throw new Error("installMobileSharedTargets requires at least one deployment");
  const appTargetsPath = path.join(opts.workspaceRoot, labelDir(opts.appTargetLabel), "TARGETS");
  const sharedTargetsPath = path.join(
    opts.workspaceRoot,
    labelDir(primary.lanePolicyRef),
    "TARGETS",
  );
  await fsp.mkdir(path.dirname(appTargetsPath), { recursive: true });
  await fsp.mkdir(path.dirname(sharedTargetsPath), { recursive: true });
  await fsp.writeFile(appTargetsPath, renderAppTargets(opts), "utf8");
  await fsp.writeFile(sharedTargetsPath, renderSharedTargets(primary, opts.deployments), "utf8");
}

export function renderRolloutPolicyLines(
  rolloutPolicy: DeploymentRolloutPolicy | undefined,
): string[] {
  if (!rolloutPolicy) return [];
  return [
    `    rollout_policy = {"mode": "${rolloutPolicy.mode}", "abort": "${rolloutPolicy.abort}", "smoke": "${rolloutPolicy.smoke}"},`,
    `    rollout_steps = [${rolloutPolicy.steps.map((step) => `"${step}"`).join(", ")}],`,
  ];
}

export function labelDir(label: string): string {
  return label.replace(/^\/\//, "").split(":")[0] || "";
}

export function labelName(label: string): string {
  return label.split(":")[1] || "";
}

function stageBranchProtection(stage: string, branch: string) {
  return {
    stage,
    branch,
    requiredChecks: [],
    fastForwardOnly: true,
    normalAdvancePrincipals: ["app:deploy-bot"],
    emergencyDirectPushPrincipals: ["team:sre-break-glass"],
  };
}

function renderAppTargets(opts: {
  appTargetLabel: string;
  appArtifactName: string;
  appArtifactMarker: string;
}): string {
  return [
    'load("@prelude//:rules.bzl", "genrule")',
    "",
    "genrule(",
    `    name = ${JSON.stringify(labelName(opts.appTargetLabel))},`,
    `    out = ${JSON.stringify(opts.appArtifactName)},`,
    `    cmd = ${JSON.stringify(`printf ${opts.appArtifactMarker} > $OUT`)},`,
    '    visibility = ["PUBLIC"],',
    ")",
    "",
  ].join("\n");
}

function renderSharedTargets(primary: MobileDeployment, deployments: MobileDeployment[]): string {
  return [
    'load("//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_lane_governance", "deployment_lane_policy")',
    "",
    "deployment_lane_governance(",
    `    name = ${JSON.stringify(labelName(primary.lanePolicy.governanceRef))},`,
    `    scm_backend = ${JSON.stringify(primary.lanePolicy.governance.scmBackend)},`,
    `    repository = ${JSON.stringify(primary.lanePolicy.governance.repository)},`,
    "    branch_protections = [",
    ...primary.lanePolicy.governance.branchProtections.map(
      (entry) =>
        `        {"stage": ${JSON.stringify(entry.stage)}, "branch": ${JSON.stringify(entry.branch)}, "required_checks": ${JSON.stringify(entry.requiredChecks.join(","))}, "fast_forward_only": ${JSON.stringify(entry.fastForwardOnly ? "true" : "false")}, "normal_advance_principals": ${JSON.stringify(entry.normalAdvancePrincipals.join(","))}, "emergency_direct_push_principals": ${JSON.stringify(entry.emergencyDirectPushPrincipals.join(","))}},`,
    ),
    "    ],",
    '    visibility = ["PUBLIC"],',
    ")",
    "",
    "deployment_lane_policy(",
    `    name = ${JSON.stringify(labelName(primary.lanePolicyRef))},`,
    `    stages = [${primary.lanePolicy.stages.map((stage) => JSON.stringify(stage)).join(", ")}],`,
    `    stage_branches = {${Object.entries(primary.lanePolicy.stageBranches)
      .map(([stage, branch]) => `${JSON.stringify(stage)}: ${JSON.stringify(branch)}`)
      .join(", ")}},`,
    `    allowed_promotion_edges = [${primary.lanePolicy.allowedPromotionEdges
      .map((edge) => JSON.stringify(edge))
      .join(", ")}],`,
    `    governance_policy = ${JSON.stringify(primary.lanePolicy.governanceRef)},`,
    '    visibility = ["PUBLIC"],',
    ")",
    "",
    ...deployments.flatMap((deployment) =>
      deployment.admissionPolicy
        ? [
            "deployment_admission_policy(",
            `    name = ${JSON.stringify(labelName(deployment.admissionPolicyRef))},`,
            `    allowed_refs = [${deployment.admissionPolicy.allowedRefs
              .map((ref) => JSON.stringify(ref))
              .join(", ")}],`,
            `    required_checks = [${deployment.admissionPolicy.requiredChecks
              .map((check) => JSON.stringify(check))
              .join(", ")}],`,
            '    visibility = ["PUBLIC"],',
            ")",
            "",
          ]
        : [],
    ),
  ].join("\n");
}
