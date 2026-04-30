import type {
  ReviewedDeployment,
  TargetsFileFragment,
} from "./deployment-targets.install.fragments.ts";
import {
  appendTargetsFragment,
  labelDir,
  labelName,
  uniqueBy,
} from "./deployment-targets.install.fragments.ts";
import { renderStringList } from "./deployment-targets.install.render.ts";
import {
  renderAdmissionPolicy,
  renderPromotionCompatibility,
  renderReleaseAction,
  renderTargetException,
} from "./deployment-targets.install.policy-renderers.ts";

export function synchronizeGovernanceChecks(deployments: ReviewedDeployment[]): void {
  for (const deployment of deployments) {
    const branchProtection = deployment.lanePolicy.governance.branchProtections.find(
      (entry) => entry.stage === deployment.environmentStage,
    );
    if (!branchProtection) continue;
    branchProtection.requiredChecks = [...deployment.admissionPolicy.requiredChecks];
  }
}

function effectiveBranchProtectionChecks(opts: {
  deployments: ReviewedDeployment[];
  governanceRef: string;
  stage: string;
  fallback: string[];
}): string[] {
  const deployment = opts.deployments.find(
    (candidate) =>
      candidate.lanePolicy.governanceRef === opts.governanceRef &&
      candidate.environmentStage === opts.stage,
  );
  return deployment?.admissionPolicy.requiredChecks || opts.fallback;
}

export function sharedPolicyTargetsByDir(
  deployments: ReviewedDeployment[],
): Map<string, TargetsFileFragment> {
  const lanePolicies = uniqueBy(
    deployments.map((deployment) => ({
      ref: deployment.lanePolicyRef,
      policy: deployment.lanePolicy,
    })),
    ({ ref }) => ref,
  );
  const governancePolicies = uniqueBy(
    lanePolicies.map(({ policy }) => ({
      ref: policy.governanceRef,
      governance: policy.governance,
    })),
    ({ ref }) => ref,
  );
  const admissionPolicies = uniqueBy(
    deployments.map((deployment) => ({
      ref: deployment.admissionPolicyRef,
      policy: deployment.admissionPolicy,
    })),
    ({ ref }) => ref,
  );
  const releaseActions = uniqueBy(
    deployments.flatMap((deployment) => deployment.releaseActions),
    (action) => action.ref,
  );
  const targetExceptions = uniqueBy(
    deployments.flatMap((deployment) => deployment.targetExceptions),
    (exception) => exception.ref,
  );
  const targetDirs = new Set<string>([
    ...lanePolicies.map(({ ref }) => labelDir(ref)),
    ...governancePolicies.map(({ ref }) => labelDir(ref)),
    ...admissionPolicies.map(({ ref }) => labelDir(ref)),
    ...releaseActions.map((action) => labelDir(action.ref)),
    ...targetExceptions.map((exception) => labelDir(exception.ref)),
  ]);
  const fragments = new Map<string, TargetsFileFragment>();
  for (const sharedDir of targetDirs) {
    appendTargetsFragment(fragments, sharedDir, {
      loadLines: [
        'load("//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_lane_governance", "deployment_lane_policy", "deployment_release_action", "deployment_target_exception")',
      ],
      bodyLines: [
        ...governancePolicies
          .filter(({ ref }) => labelDir(ref) === sharedDir)
          .flatMap(({ ref, governance }) => [
            "deployment_lane_governance(",
            `    name = ${JSON.stringify(labelName(ref))},`,
            `    scm_backend = ${JSON.stringify(governance.scmBackend)},`,
            `    repository = ${JSON.stringify(governance.repository)},`,
            "    branch_protections = [",
            ...governance.branchProtections.map((entry) => {
              const requiredChecks = effectiveBranchProtectionChecks({
                deployments,
                governanceRef: ref,
                stage: entry.stage,
                fallback: entry.requiredChecks,
              });
              return `        {"stage": ${JSON.stringify(entry.stage)}, "branch": ${JSON.stringify(entry.branch)}, "required_checks": ${JSON.stringify(requiredChecks.join(","))}, "fast_forward_only": ${JSON.stringify(entry.fastForwardOnly ? "true" : "false")}, "normal_advance_principals": ${JSON.stringify(entry.normalAdvancePrincipals.join(","))}, "emergency_direct_push_principals": ${JSON.stringify(entry.emergencyDirectPushPrincipals.join(","))}},`;
            }),
            "    ],",
            '    visibility = ["PUBLIC"],',
            ")",
            "",
          ]),
        ...lanePolicies
          .filter(({ ref }) => labelDir(ref) === sharedDir)
          .flatMap(({ ref, policy }) => {
            const promotionCompatibility = renderPromotionCompatibility(policy);
            return [
              "deployment_lane_policy(",
              `    name = ${JSON.stringify(labelName(ref))},`,
              `    stages = ${renderStringList(policy.stages)},`,
              `    stage_branches = {${Object.entries(policy.stageBranches)
                .map(([stage, branch]) => `${JSON.stringify(stage)}: ${JSON.stringify(branch)}`)
                .join(", ")}},`,
              `    allowed_promotion_edges = ${renderStringList(policy.allowedPromotionEdges)},`,
              `    artifact_reuse_mode = ${JSON.stringify(policy.artifactReuseMode)},`,
              ...(promotionCompatibility
                ? [`    promotion_compatibility = ${JSON.stringify(promotionCompatibility)},`]
                : []),
              ...(policy.defaultClientProfile
                ? [`    default_client_profile = ${JSON.stringify(policy.defaultClientProfile)},`]
                : []),
              `    governance_policy = ${JSON.stringify(policy.governanceRef)},`,
              '    visibility = ["PUBLIC"],',
              ")",
              "",
            ];
          }),
        ...admissionPolicies
          .filter(({ ref }) => labelDir(ref) === sharedDir)
          .flatMap(({ ref, policy }) => renderAdmissionPolicy(ref, policy)),
        ...releaseActions
          .filter((action) => labelDir(action.ref) === sharedDir)
          .flatMap((action) => renderReleaseAction(action)),
        ...targetExceptions
          .filter((exception) => labelDir(exception.ref) === sharedDir)
          .flatMap((exception) => renderTargetException(exception)),
      ],
    });
  }
  return fragments;
}
