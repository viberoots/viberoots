#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  KUBERNETES_PROVIDER,
  deriveKubernetesProviderTarget,
  type KubernetesDeployment,
} from "../../deployments/contract";
import type { GraphNode } from "../../lib/graph";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture";
export { installKubernetesTargets } from "./deployment-targets.install.helpers";

export function kubernetesDeploymentFixture(
  overrides: Partial<KubernetesDeployment> = {},
): KubernetesDeployment {
  const defaultLanePolicy = nixosSharedHostLanePolicyFixture();
  const lanePolicy =
    overrides.lanePolicy ||
    nixosSharedHostLanePolicyFixture({
      governance: {
        ...defaultLanePolicy.governance,
        requiredApprovalBoundaries: [{ stage: "staging", requiredApprovals: ["release-owner"] }],
      },
    });
  const admissionPolicy =
    overrides.admissionPolicy ||
    nixosSharedHostAdmissionPolicyFixture({
      ref: "//projects/deployments/sample-webapp/shared:prod_release",
      name: "prod_release",
      allowedRefs: ["refs/tags/release/*"],
      requiredChecks: [],
      requiredApprovals: [],
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
    label: overrides.label || "//projects/deployments/shared-observability-prod:deploy",
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
      target: "//projects/apps/api:image",
    },
    components: overrides.components || [
      {
        id: "api",
        kind: "service",
        target: "//projects/apps/api:image",
      },
    ],
    publisher: overrides.publisher || { type: "helm-release", config: "helm/values.yaml" },
    ...(overrides.provisioner ? { provisioner: overrides.provisioner } : {}),
    ...(overrides.vaultRuntime ? { vaultRuntime: overrides.vaultRuntime } : {}),
    providerTarget,
  };
}

export async function writeKubernetesLiveStateFixture(
  root: string,
  deployment: KubernetesDeployment,
  overrides: Record<string, string> = {},
): Promise<string> {
  const liveStatePath = path.join(root, `${deployment.deploymentId}-live-state.json`);
  await fsp.writeFile(
    liveStatePath,
    JSON.stringify(
      {
        cluster: deployment.providerTarget.cluster,
        namespace: deployment.providerTarget.namespace,
        release: deployment.providerTarget.release,
        providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
        ...overrides,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return liveStatePath;
}

export function kubernetesAdmissionPolicyNodeFixture(
  overrides: Partial<GraphNode> = {},
): GraphNode {
  return nixosSharedHostAdmissionPolicyNodeFixture({
    name: "//projects/deployments/sample-webapp/shared:prod_release",
    allowed_refs: ["refs/tags/release/*"],
    required_checks: ["deploy/shared-observability-prod"],
    required_approvals: ["release-owner"],
    ...overrides,
  });
}

export function kubernetesLanePolicyNodeFixture(overrides: Partial<GraphNode> = {}): GraphNode {
  return nixosSharedHostLanePolicyNodeFixture(overrides);
}
