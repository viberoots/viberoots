#!/usr/bin/env zx-wrapper
import {
  deriveNixosSharedHostProviderTarget,
  NIXOS_SHARED_HOST_PROVIDER,
  STATIC_WEBAPP_COMPONENT,
  type NixosSharedHostDeployment,
} from "../../deployments/contract.ts";
import {
  DEPLOYMENT_ADMISSION_POLICY_RULE,
  DEPLOYMENT_LANE_POLICY_RULE,
  type DeploymentAdmissionPolicy,
  type DeploymentLanePolicy,
} from "../../deployments/deployment-policy.ts";
import type { GraphNode } from "../../lib/graph.ts";

export function nixosSharedHostLanePolicyFixture(
  overrides: Partial<DeploymentLanePolicy> = {},
): DeploymentLanePolicy {
  return {
    ref: overrides.ref || "//projects/deployments/pleomino-shared:lane",
    name: overrides.name || "lane",
    stages: overrides.stages || ["dev", "staging", "prod"],
    stageBranches: overrides.stageBranches || {
      dev: "env/pleomino/dev",
      staging: "env/pleomino/staging",
      prod: "env/pleomino/prod",
    },
    allowedPromotionEdges: overrides.allowedPromotionEdges || ["dev->staging", "staging->prod"],
    artifactReuseMode: overrides.artifactReuseMode || "same_artifact",
    fingerprint: overrides.fingerprint || "sha256:lane-pleomino",
  };
}

export function nixosSharedHostAdmissionPolicyFixture(
  overrides: Partial<DeploymentAdmissionPolicy> = {},
): DeploymentAdmissionPolicy {
  return {
    ref: overrides.ref || "//projects/deployments/pleomino-shared:dev_release",
    name: overrides.name || "dev_release",
    allowedRefs: overrides.allowedRefs || ["env/pleomino/dev"],
    requiredChecks: overrides.requiredChecks || ["deploy/pleomino-dev"],
    requiredApprovals: overrides.requiredApprovals || [],
    retryBranchPolicy: overrides.retryBranchPolicy || "branch_independent",
    retryApprovalReuse: overrides.retryApprovalReuse || "fresh_only",
    artifactAttestationMode: overrides.artifactAttestationMode || "recorded_exact_artifact",
    fingerprint: overrides.fingerprint || "sha256:admission-pleomino-dev",
  };
}

export function nixosSharedHostLanePolicyNodeFixture(
  overrides: Partial<GraphNode> = {},
): GraphNode {
  const policy = nixosSharedHostLanePolicyFixture();
  return {
    name: policy.ref,
    rule_type: DEPLOYMENT_LANE_POLICY_RULE,
    stages: policy.stages,
    stage_branches: policy.stageBranches,
    allowed_promotion_edges: policy.allowedPromotionEdges,
    artifact_reuse_mode: policy.artifactReuseMode,
    ...overrides,
  };
}

export function nixosSharedHostAdmissionPolicyNodeFixture(
  overrides: Partial<GraphNode> = {},
): GraphNode {
  const policy = nixosSharedHostAdmissionPolicyFixture();
  return {
    name: policy.ref,
    rule_type: DEPLOYMENT_ADMISSION_POLICY_RULE,
    allowed_refs: policy.allowedRefs,
    required_checks: policy.requiredChecks,
    required_approvals: policy.requiredApprovals,
    retry_branch_policy: policy.retryBranchPolicy,
    retry_approval_reuse: policy.retryApprovalReuse,
    artifact_attestation_mode: policy.artifactAttestationMode,
    ...overrides,
  };
}

export async function ensureNixosSharedHostStageBranch(
  cwd: string,
  $: any,
  deployment: {
    lanePolicy: { stageBranches: Record<string, string> };
    environmentStage: string;
  },
) {
  const branch = deployment.lanePolicy.stageBranches[deployment.environmentStage];
  await $({ cwd, stdio: "pipe" })`git branch -f ${branch} HEAD`;
}

export function nixosSharedHostDeploymentFixture(
  overrides: Partial<NixosSharedHostDeployment> = {},
): NixosSharedHostDeployment {
  const appName = overrides.runtime?.appName || "demoapp";
  const targetGroup = overrides.runtime?.targetGroup || "default";
  const lanePolicy = overrides.lanePolicy || nixosSharedHostLanePolicyFixture();
  const admissionPolicy =
    overrides.admissionPolicy || nixosSharedHostAdmissionPolicyFixture({ requiredChecks: [] });
  const defaultComponentProviderTarget = {
    ...deriveNixosSharedHostProviderTarget({ appName, targetGroup }),
    ...(overrides.providerTarget || {}),
  };
  const components = overrides.components || [
    {
      id: "default",
      kind: STATIC_WEBAPP_COMPONENT,
      target: overrides.component?.target || "//projects/apps/demoapp:app",
      runtime: {
        appName,
        containerPort: overrides.runtime?.containerPort || 3000,
        ...(overrides.runtime?.healthPath ? { healthPath: overrides.runtime.healthPath } : {}),
        ...(overrides.runtime?.targetGroup ? { targetGroup: overrides.runtime.targetGroup } : {}),
      },
      providerTarget: defaultComponentProviderTarget,
    },
  ];
  const providerTarget = {
    ...deriveNixosSharedHostProviderTarget({
      appNames: components.map((component) => component.runtime.appName),
      targetGroup: components[0]?.providerTarget.targetGroup || targetGroup,
    }),
    ...(overrides.providerTarget || {}),
  };
  return {
    deploymentId: overrides.deploymentId || "demoapp-dev",
    label: overrides.label || "//projects/deployments/demoapp-dev:deploy",
    name: overrides.name || "deploy",
    provider: NIXOS_SHARED_HOST_PROVIDER,
    protectionClass: overrides.protectionClass || "shared_nonprod",
    lanePolicyRef: overrides.lanePolicyRef || lanePolicy.ref,
    lanePolicy,
    environmentStage: overrides.environmentStage || "dev",
    admissionPolicyRef: overrides.admissionPolicyRef || admissionPolicy.ref,
    admissionPolicy,
    prerequisites: overrides.prerequisites || [],
    secretRequirements: overrides.secretRequirements || [],
    runtimeConfigRequirements: overrides.runtimeConfigRequirements || [],
    releaseActions: overrides.releaseActions || [],
    targetExceptions: overrides.targetExceptions || [],
    ...(overrides.rolloutPolicy ? { rolloutPolicy: overrides.rolloutPolicy } : {}),
    ...(overrides.bootstrap ? { bootstrap: overrides.bootstrap } : {}),
    component: {
      kind: STATIC_WEBAPP_COMPONENT,
      target: components[0]?.target || overrides.component?.target || "//projects/apps/demoapp:app",
    },
    components,
    publisher: overrides.publisher || { type: "nixos-shared-host-static-webapp" },
    provisioner: overrides.provisioner || { type: "nixos-shared-host-manifest" },
    runtime: {
      appName: components[0]?.runtime.appName || appName,
      containerPort:
        components[0]?.runtime.containerPort || overrides.runtime?.containerPort || 3000,
      ...(components[0]?.runtime.healthPath
        ? { healthPath: components[0].runtime.healthPath }
        : {}),
      ...(components[0]?.runtime.targetGroup
        ? { targetGroup: components[0].runtime.targetGroup }
        : {}),
    },
    providerTarget,
  };
}
