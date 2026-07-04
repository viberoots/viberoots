#!/usr/bin/env zx-wrapper
import {
  CLOUDFLARE_PAGES_PROVIDER,
  deriveCloudflarePagesProviderTarget,
  STATIC_WEBAPP_COMPONENT,
  type DeploymentPreviewPolicy,
  type CloudflarePagesDeployment,
} from "../../deployments/contract";
import type { GraphNode } from "../../lib/graph";
import type { DeploymentRequirement } from "../../deployments/deployment-requirements";
import { nixosSharedHostLaneGovernanceNodeFixture } from "./deployment-lane-governance.fixture";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture";
export { installCloudflarePagesTargets } from "./deployment-targets.install.helpers";

export function cloudflarePagesPreviewFixture(
  overrides: Partial<DeploymentPreviewPolicy> = {},
): DeploymentPreviewPolicy {
  return {
    targetDerivation: "provider_managed_source_run",
    isolationClass: "isolated",
    identitySelector: "source_run",
    cleanupTtl: "7d",
    smokeTarget: "preview_url",
    lockScope: "shared",
    ...overrides,
  };
}

export function cloudflarePagesApiTokenRequirements(): DeploymentRequirement[] {
  return [
    {
      name: "cloudflare_api_token",
      step: "publish",
      contractId: "secret://deployments/sample-webapp/cloudflare_api_token",
      required: true,
    },
    {
      name: "cloudflare_api_token",
      step: "preview_cleanup",
      contractId: "secret://deployments/sample-webapp/cloudflare_api_token",
      required: true,
    },
  ];
}

export function cloudflarePagesDeploymentFixture(
  overrides: Partial<CloudflarePagesDeployment> = {},
): CloudflarePagesDeployment {
  const lanePolicy = overrides.lanePolicy || nixosSharedHostLanePolicyFixture();
  const admissionPolicy =
    overrides.admissionPolicy ||
    nixosSharedHostAdmissionPolicyFixture({
      ref: "//projects/deployments/sample-webapp/shared:staging_release",
      name: "staging_release",
      allowedRefs: ["main", "refs/tags/release/*"],
      requiredChecks: [],
      fingerprint: "sha256:admission-sample-webapp-staging",
    });
  const providerTarget = {
    ...deriveCloudflarePagesProviderTarget({
      account: "web-platform-staging",
      project: "sample-webapp-staging-pages",
    }),
    ...(overrides.providerTarget || {}),
  };
  return {
    deploymentId: overrides.deploymentId || "sample-webapp-staging",
    label: overrides.label || "//projects/deployments/sample-webapp/staging:deploy",
    name: overrides.name || "deploy",
    provider: CLOUDFLARE_PAGES_PROVIDER,
    protectionClass: overrides.protectionClass || "shared_nonprod",
    lanePolicyRef: overrides.lanePolicyRef || lanePolicy.ref,
    lanePolicy,
    environmentStage: overrides.environmentStage || "staging",
    admissionPolicyRef: overrides.admissionPolicyRef || admissionPolicy.ref,
    admissionPolicy,
    prerequisites: overrides.prerequisites || [],
    secretRequirements: overrides.secretRequirements || [],
    runtimeConfigRequirements: overrides.runtimeConfigRequirements || [],
    releaseActions: overrides.releaseActions || [],
    targetExceptions: overrides.targetExceptions || [],
    ...(overrides.deploymentContext ? { deploymentContext: overrides.deploymentContext } : {}),
    ...(overrides.controlPlane ? { controlPlane: overrides.controlPlane } : {}),
    ...(overrides.smoke ? { smoke: overrides.smoke } : {}),
    ...(overrides.rolloutPolicy ? { rolloutPolicy: overrides.rolloutPolicy } : {}),
    ...(overrides.vaultRuntime ? { vaultRuntime: overrides.vaultRuntime } : {}),
    component: {
      kind: STATIC_WEBAPP_COMPONENT,
      target: overrides.component?.target || "//projects/apps/sample-webapp:app",
    },
    components: overrides.components || [
      {
        id: "default",
        kind: STATIC_WEBAPP_COMPONENT,
        target: overrides.component?.target || "//projects/apps/sample-webapp:app",
      },
    ],
    ...(overrides.preview ? { preview: overrides.preview } : {}),
    publisher: overrides.publisher || { type: "wrangler-pages", config: "wrangler.jsonc" },
    providerTarget,
  };
}

export function cloudflarePagesAdmissionPolicyNodeFixture(
  overrides: Partial<GraphNode> = {},
): GraphNode {
  return nixosSharedHostAdmissionPolicyNodeFixture({
    name: "//projects/deployments/sample-webapp/shared:staging_release",
    allowed_refs: ["main", "refs/tags/release/*"],
    required_checks: ["deploy/sample-webapp-staging"],
    ...overrides,
  });
}

export function cloudflarePagesLanePolicyNodeFixture(
  overrides: Partial<GraphNode> = {},
): GraphNode {
  return nixosSharedHostLanePolicyNodeFixture(overrides);
}

export function cloudflarePagesLaneGovernanceNodeFixture(
  overrides: Partial<GraphNode> = {},
): GraphNode {
  return nixosSharedHostLaneGovernanceNodeFixture(overrides);
}
