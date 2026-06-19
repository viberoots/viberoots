import type {
  ReviewedDeployment,
  TargetsFileFragment,
} from "./deployment-targets.install.fragments";
import {
  appendTargetsFragment,
  labelDir,
  labelName,
  uniqueBy,
} from "./deployment-targets.install.fragments";
import { renderStringList, renderStringRecordList } from "./deployment-targets.install.render";
import {
  renderAdmissionPolicy,
  renderPromotionCompatibility,
  renderReleaseAction,
  renderTargetException,
} from "./deployment-targets.install.policy-renderers";
import type { DeploymentAdmissionPolicy } from "../../deployments/deployment-policy";

export function synchronizeGovernanceChecks(deployments: ReviewedDeployment[]): void {
  for (const deployment of deployments) {
    const sourceRefPolicy = deployment.lanePolicy.governance.sourceRefPolicies.find(
      (entry) => entry.stage === deployment.environmentStage,
    );
    if (!sourceRefPolicy) continue;
    sourceRefPolicy.requiredChecks = [...deployment.admissionPolicy.requiredChecks];
  }
}

function effectiveSourceRefPolicyChecks(opts: {
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

function stageAdmissionPolicies(opts: {
  deployments: ReviewedDeployment[];
  lanePolicies: Array<{ ref: string; policy: ReviewedDeployment["lanePolicy"] }>;
}): Array<{ ref: string; policy: DeploymentAdmissionPolicy }> {
  const explicit = opts.deployments.map((deployment) => ({
    ref: deployment.admissionPolicyRef,
    policy: deployment.admissionPolicy,
  }));
  const refs = new Set(explicit.map(({ ref }) => ref));
  const implied: Array<{ ref: string; policy: DeploymentAdmissionPolicy }> = [];
  for (const { ref: laneRef, policy: lanePolicy } of opts.lanePolicies) {
    const firstPolicy = opts.deployments.find(
      (deployment) => deployment.lanePolicyRef === laneRef,
    )?.admissionPolicy;
    if (!firstPolicy) continue;
    const sharedDir = labelDir(laneRef);
    for (const stagePolicy of lanePolicy.governance.sourceRefPolicies) {
      const policyRef = `//${sharedDir}:${stagePolicy.stage}_release`;
      if (refs.has(policyRef)) continue;
      const approvalBoundary = lanePolicy.governance.requiredApprovalBoundaries.find(
        (entry) => entry.stage === stagePolicy.stage,
      );
      refs.add(policyRef);
      implied.push({
        ref: policyRef,
        policy: {
          ...firstPolicy,
          ref: policyRef,
          name: labelName(policyRef),
          allowedRefs: stagePolicy.allowedRefs,
          requiredChecks: effectiveSourceRefPolicyChecks({
            deployments: opts.deployments,
            governanceRef: lanePolicy.governanceRef,
            stage: stagePolicy.stage,
            fallback: stagePolicy.requiredChecks,
          }),
          requiredApprovals: approvalBoundary?.requiredApprovals || [],
        },
      });
    }
  }
  return [...explicit, ...implied];
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
    stageAdmissionPolicies({ deployments, lanePolicies }),
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
        'load("@viberoots//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_lane_governance", "deployment_lane_policy", "deployment_release_action", "deployment_target_exception")',
      ],
      bodyLines: [
        ...governancePolicies
          .filter(({ ref }) => labelDir(ref) === sharedDir)
          .flatMap(({ ref, governance }) => [
            "deployment_lane_governance(",
            `    name = ${JSON.stringify(labelName(ref))},`,
            `    scm_backend = ${JSON.stringify(governance.scmBackend)},`,
            `    repository = ${JSON.stringify(governance.repository)},`,
            "    source_ref_policies =",
            ...renderStringRecordList(
              governance.sourceRefPolicies.map((entry) => {
                const requiredChecks = effectiveSourceRefPolicyChecks({
                  deployments,
                  governanceRef: ref,
                  stage: entry.stage,
                  fallback: entry.requiredChecks,
                });
                return {
                  stage: entry.stage,
                  allowed_refs: entry.allowedRefs.join(","),
                  required_checks: requiredChecks.join(","),
                };
              }),
            ),
            `    trusted_reporter_identities = ${renderStringList(governance.trustedReporterIdentities)},`,
            "    required_approval_boundaries =",
            ...renderStringRecordList(
              governance.requiredApprovalBoundaries.map((entry) => ({
                stage: entry.stage,
                required_approvals: entry.requiredApprovals.join(","),
              })),
            ),
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
              "    source_ref_policy = {",
              ...Object.entries(policy.sourceRefPolicy).map(
                ([stage, sourceRef]) =>
                  `        ${JSON.stringify(stage)}: ${JSON.stringify(sourceRef)},`,
              ),
              "    },",
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
