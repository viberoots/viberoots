#!/usr/bin/env zx-wrapper
import {
  CLOUDFLARE_PAGES_PROVIDER,
  deriveCloudflarePagesProviderTarget,
  STATIC_WEBAPP_COMPONENT,
  type DeploymentPreviewPolicy,
  type CloudflarePagesDeployment,
} from "../../deployments/contract.ts";
import type { GraphNode } from "../../lib/graph.ts";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture.ts";

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

export function cloudflarePagesDeploymentFixture(
  overrides: Partial<CloudflarePagesDeployment> = {},
): CloudflarePagesDeployment {
  const lanePolicy = overrides.lanePolicy || nixosSharedHostLanePolicyFixture();
  const admissionPolicy =
    overrides.admissionPolicy ||
    nixosSharedHostAdmissionPolicyFixture({
      ref: "//projects/deployments/pleomino-shared:staging_release",
      name: "staging_release",
      allowedRefs: ["env/pleomino/staging"],
      requiredChecks: ["deploy/pleomino-staging"],
      fingerprint: "sha256:admission-pleomino-staging",
    });
  const providerTarget = {
    ...deriveCloudflarePagesProviderTarget({
      account: "web-platform-staging",
      project: "pleomino-staging-pages",
    }),
    ...(overrides.providerTarget || {}),
  };
  return {
    deploymentId: overrides.deploymentId || "pleomino-staging",
    label: overrides.label || "//projects/deployments/pleomino-staging:deploy",
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
    ...(overrides.rolloutPolicy ? { rolloutPolicy: overrides.rolloutPolicy } : {}),
    component: {
      kind: STATIC_WEBAPP_COMPONENT,
      target: overrides.component?.target || "//projects/apps/pleomino:app",
    },
    components: overrides.components || [
      {
        id: "default",
        kind: STATIC_WEBAPP_COMPONENT,
        target: overrides.component?.target || "//projects/apps/pleomino:app",
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
    name: "//projects/deployments/pleomino-shared:staging_release",
    allowed_refs: ["env/pleomino/staging"],
    required_checks: ["deploy/pleomino-staging"],
    ...overrides,
  });
}

export function cloudflarePagesLanePolicyNodeFixture(
  overrides: Partial<GraphNode> = {},
): GraphNode {
  return nixosSharedHostLanePolicyNodeFixture(overrides);
}
