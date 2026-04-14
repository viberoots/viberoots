#!/usr/bin/env zx-wrapper
import {
  KUBERNETES_PROVIDER,
  deriveKubernetesProviderTarget,
  type KubernetesDeployment,
} from "../../deployments/contract.ts";
import type { GraphNode } from "../../lib/graph.ts";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture.ts";
export { installKubernetesTargets } from "./deployment-targets.install.helpers.ts";

export function kubernetesDeploymentFixture(
  overrides: Partial<KubernetesDeployment> = {},
): KubernetesDeployment {
  const lanePolicy = overrides.lanePolicy || nixosSharedHostLanePolicyFixture();
  const admissionPolicy =
    overrides.admissionPolicy ||
    nixosSharedHostAdmissionPolicyFixture({
      ref: "//test-workspace/deployments/platform-shared:prod_release",
      name: "prod_release",
      allowedRefs: ["env/pleomino/prod"],
      requiredChecks: [],
      fingerprint: "sha256:admission-platform-prod",
    });
  const providerTarget = {
    ...deriveKubernetesProviderTarget({
      cluster: "prod-us-west",
      namespace: "shared-observability",
      release: "shared-observability",
    }),
    ...(overrides.providerTarget || {}),
  };
  return {
    deploymentId: overrides.deploymentId || "shared-observability-prod",
    label: overrides.label || "//test-workspace/deployments/shared-observability-prod:deploy",
    name: overrides.name || "deploy",
    provider: KUBERNETES_PROVIDER,
    protectionClass: overrides.protectionClass || "production_facing",
    lanePolicyRef: overrides.lanePolicyRef || lanePolicy.ref,
    lanePolicy,
    environmentStage: overrides.environmentStage || "prod",
    admissionPolicyRef: overrides.admissionPolicyRef || admissionPolicy.ref,
    admissionPolicy,
    prerequisites: overrides.prerequisites || [],
    secretRequirements: overrides.secretRequirements || [],
    runtimeConfigRequirements: overrides.runtimeConfigRequirements || [],
    releaseActions: overrides.releaseActions || [],
    targetExceptions: overrides.targetExceptions || [],
    ...(overrides.rolloutPolicy ? { rolloutPolicy: overrides.rolloutPolicy } : {}),
    component: overrides.component || {
      kind: "service",
      target: "//test-workspace/apps/api:image",
    },
    components: overrides.components || [
      {
        id: "api",
        kind: "service",
        target: "//test-workspace/apps/api:image",
      },
    ],
    publisher: overrides.publisher || { type: "helm-release", config: "helm/values.yaml" },
    ...(overrides.provisioner ? { provisioner: overrides.provisioner } : {}),
    providerTarget,
  };
}

export function kubernetesAdmissionPolicyNodeFixture(
  overrides: Partial<GraphNode> = {},
): GraphNode {
  return nixosSharedHostAdmissionPolicyNodeFixture({
    name: "//test-workspace/deployments/platform-shared:prod_release",
    allowed_refs: ["env/pleomino/prod"],
    required_checks: ["deploy/shared-observability-prod"],
    ...overrides,
  });
}

export function kubernetesLanePolicyNodeFixture(overrides: Partial<GraphNode> = {}): GraphNode {
  return nixosSharedHostLanePolicyNodeFixture(overrides);
}
