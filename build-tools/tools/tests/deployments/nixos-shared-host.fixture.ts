#!/usr/bin/env zx-wrapper
import {
  deriveNixosSharedHostProviderTarget,
  NIXOS_SHARED_HOST_PROVIDER,
  SSR_WEBAPP_COMPONENT,
  STATIC_WEBAPP_COMPONENT,
  type NixosSharedHostSsrRuntimeContract,
  type NixosSharedHostDeployment,
} from "../../deployments/contract.ts";
import {
  DEPLOYMENT_ADMISSION_POLICY_RULE,
  DEPLOYMENT_LANE_POLICY_RULE,
  type DeploymentAdmissionPolicy,
  type DeploymentLanePolicy,
} from "../../deployments/deployment-policy.ts";
import type { DeploymentLanePromotionCompatibility } from "../../deployments/deployment-lane-promotion-compatibility.ts";
import type { GraphNode } from "../../lib/graph.ts";
import type {
  DeploymentAttestationPolicy,
  DeploymentSbomPolicy,
  DeploymentSupplyChainGatePolicy,
} from "../../deployments/deployment-admission-supply-chain.ts";
import { nixosSharedHostLaneGovernanceFixture } from "./deployment-lane-governance.fixture.ts";
export { installNixosSharedHostTargets } from "./deployment-targets.install.helpers.ts";

export function nixosSharedHostSsrRuntimeContractFixture(
  overrides: Partial<NixosSharedHostSsrRuntimeContract> = {},
): NixosSharedHostSsrRuntimeContract {
  return {
    type: "node-dist-server-v1",
    framework: overrides.framework || "vite",
    serverEntry: overrides.serverEntry || "dist/server/index.js",
    clientDir: overrides.clientDir || "dist/client",
    servingTopology: overrides.servingTopology || "single-host-node-with-nginx",
    environmentNeutralBuild: overrides.environmentNeutralBuild ?? true,
    runtimeConfigInjection: overrides.runtimeConfigInjection || "runtime_config_requirements",
    secretInjection: overrides.secretInjection || "secret_requirements",
  };
}

export function nixosSharedHostLanePolicyFixture(
  overrides: Partial<DeploymentLanePolicy> = {},
): DeploymentLanePolicy {
  const governance = overrides.governance || nixosSharedHostLaneGovernanceFixture();
  const promotionCompatibility = overrides.promotionCompatibility as
    | DeploymentLanePromotionCompatibility
    | undefined;
  return {
    ref: overrides.ref || "//test-workspace/deployments/pleomino-shared:lane",
    name: overrides.name || "lane",
    stages: overrides.stages || ["dev", "staging", "prod"],
    stageBranches: overrides.stageBranches || {
      dev: "env/pleomino/dev",
      staging: "env/pleomino/staging",
      prod: "env/pleomino/prod",
    },
    allowedPromotionEdges: overrides.allowedPromotionEdges || ["dev->staging", "staging->prod"],
    artifactReuseMode: overrides.artifactReuseMode || "same_artifact",
    ...(promotionCompatibility ? { promotionCompatibility } : {}),
    governanceRef: overrides.governanceRef || governance.ref,
    governance,
    fingerprint: overrides.fingerprint || "sha256:lane-pleomino",
  };
}

export function nixosSharedHostAdmissionPolicyFixture(
  overrides: Partial<DeploymentAdmissionPolicy> = {},
): DeploymentAdmissionPolicy {
  return {
    ref: overrides.ref || "//test-workspace/deployments/pleomino-shared:dev_release",
    name: overrides.name || "dev_release",
    allowedRefs: overrides.allowedRefs || ["env/pleomino/dev"],
    requiredChecks: overrides.requiredChecks || ["deploy/pleomino-dev"],
    requiredApprovals: overrides.requiredApprovals || [],
    retryBranchPolicy: overrides.retryBranchPolicy || "branch_independent",
    retryApprovalReuse: overrides.retryApprovalReuse || "fresh_only",
    artifactAttestationMode: overrides.artifactAttestationMode || "recorded_exact_artifact",
    ...(overrides.attestation
      ? { attestation: overrides.attestation as DeploymentAttestationPolicy }
      : {}),
    ...(overrides.sbom ? { sbom: overrides.sbom as DeploymentSbomPolicy } : {}),
    supplyChainGates: overrides.supplyChainGates || ([] as DeploymentSupplyChainGatePolicy[]),
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
    promotion_compatibility: policy.promotionCompatibility
      ? JSON.stringify({
          cross_provider_promotion_edges: policy.promotionCompatibility.crossProviderPromotionEdges,
        })
      : "",
    governance_policy: policy.governanceRef,
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
    trusted_builder_identities: policy.attestation?.trustedBuilderIdentities || [],
    accepted_provenance_formats: policy.attestation?.acceptedProvenanceFormats || [],
    artifact_binding: policy.attestation?.artifactBinding || "",
    expired_attestation_behavior: policy.attestation?.expiredBehavior || "",
    revoked_attestation_behavior: policy.attestation?.revokedBehavior || "",
    attestation_trust_drift_behavior: policy.attestation?.trustDriftBehavior || "",
    require_artifact_signatures: policy.attestation?.signatureRequired || false,
    trusted_signer_identities: policy.attestation?.trustedSignerIdentities || [],
    sbom_required: policy.sbom?.required || false,
    accepted_sbom_formats: policy.sbom?.acceptedFormats || [],
    supply_chain_gates: policy.supplyChainGates || [],
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
  const componentKind = overrides.component?.kind || STATIC_WEBAPP_COMPONENT;
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
      kind: componentKind,
      target: overrides.component?.target || "//test-workspace/apps/demoapp:app",
      runtime: {
        appName,
        containerPort: overrides.runtime?.containerPort || 3000,
        ...(overrides.runtime?.healthPath ? { healthPath: overrides.runtime.healthPath } : {}),
        ...(overrides.runtime?.targetGroup ? { targetGroup: overrides.runtime.targetGroup } : {}),
        ...(componentKind === SSR_WEBAPP_COMPONENT
          ? {
              runtimeContract:
                "runtimeContract" in (overrides.runtime || {})
                  ? (overrides.runtime as any).runtimeContract
                  : nixosSharedHostSsrRuntimeContractFixture(),
            }
          : {}),
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
    label: overrides.label || "//test-workspace/deployments/demoapp-dev:deploy",
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
    ...(overrides.smoke ? { smoke: overrides.smoke } : {}),
    ...(overrides.rolloutPolicy ? { rolloutPolicy: overrides.rolloutPolicy } : {}),
    ...(overrides.bootstrap ? { bootstrap: overrides.bootstrap } : {}),
    component: {
      kind: components[0]?.kind || componentKind,
      target:
        components[0]?.target || overrides.component?.target || "//test-workspace/apps/demoapp:app",
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
