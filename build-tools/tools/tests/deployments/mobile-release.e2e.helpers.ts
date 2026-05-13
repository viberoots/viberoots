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
      sourceRefPolicies: [
        { stage: "dev", allowedRefs: ["main"], requiredChecks: [] },
        { stage: "staging", allowedRefs: ["main", "refs/tags/release/*"], requiredChecks: [] },
        { stage: "prod", allowedRefs: ["refs/tags/release/*"], requiredChecks: [] },
      ],
    }),
    sourceRefPolicy: { dev: "main", staging: "main", prod: "refs/tags/release/*" },
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
    "    source_ref_policies = [",
    ...primary.lanePolicy.governance.sourceRefPolicies.map(
      (entry) =>
        `        {"stage": ${JSON.stringify(entry.stage)}, "allowed_refs": ${JSON.stringify(entry.allowedRefs.join(","))}, "required_checks": ${JSON.stringify(entry.requiredChecks.join(","))}},`,
    ),
    "    ],",
    `    trusted_reporter_identities = [${primary.lanePolicy.governance.trustedReporterIdentities.map((identity) => JSON.stringify(identity)).join(", ")}],`,
    "    required_approval_boundaries = [",
    ...primary.lanePolicy.governance.requiredApprovalBoundaries.map(
      (entry) =>
        `        {"stage": ${JSON.stringify(entry.stage)}, "required_approvals": ${JSON.stringify(entry.requiredApprovals.join(","))}},`,
    ),
    "    ],",
    '    visibility = ["PUBLIC"],',
    ")",
    "",
    "deployment_lane_policy(",
    `    name = ${JSON.stringify(labelName(primary.lanePolicyRef))},`,
    `    stages = [${primary.lanePolicy.stages.map((stage) => JSON.stringify(stage)).join(", ")}],`,
    `    source_ref_policy = {${Object.entries(primary.lanePolicy.sourceRefPolicy)
      .map(([stage, sourceRef]) => `${JSON.stringify(stage)}: ${JSON.stringify(sourceRef)}`)
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
            `    required_approvals = [${deployment.admissionPolicy.requiredApprovals
              .map((approval) => JSON.stringify(approval))
              .join(", ")}],`,
            '    visibility = ["PUBLIC"],',
            ")",
            "",
          ]
        : [],
    ),
  ].join("\n");
}
