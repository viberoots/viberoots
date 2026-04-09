#!/usr/bin/env zx-wrapper
import {
  S3_STATIC_PROVIDER,
  STATIC_WEBAPP_COMPONENT,
  deriveS3StaticProviderTarget,
  type S3StaticDeployment,
} from "../../deployments/contract.ts";
import type { GraphNode } from "../../lib/graph.ts";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture.ts";

export function s3StaticDeploymentFixture(
  overrides: Partial<S3StaticDeployment> = {},
): S3StaticDeployment {
  const lanePolicy = overrides.lanePolicy || nixosSharedHostLanePolicyFixture();
  const admissionPolicy =
    overrides.admissionPolicy ||
    nixosSharedHostAdmissionPolicyFixture({
      ref: "//projects/deployments/pleomino-shared:staging_release",
      name: "staging_release",
      allowedRefs: ["env/pleomino/staging"],
      requiredChecks: [],
      fingerprint: "sha256:admission-pleomino-s3-staging",
    });
  const providerTarget = {
    ...deriveS3StaticProviderTarget({
      account: "web-platform-staging",
      bucket: "pleomino-staging-site",
      region: "us-west-2",
      distribution: "staging.example.test",
    }),
    ...(overrides.providerTarget || {}),
  };
  return {
    deploymentId: overrides.deploymentId || "pleomino-staging-s3",
    label: overrides.label || "//projects/deployments/pleomino-staging-s3:deploy",
    name: overrides.name || "deploy",
    provider: S3_STATIC_PROVIDER,
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
    publisher: overrides.publisher || { type: "aws-s3-sync", config: "aws-s3-sync.jsonc" },
    ...(overrides.provisioner ? { provisioner: overrides.provisioner } : {}),
    providerTarget,
  };
}

export function s3StaticAdmissionPolicyNodeFixture(overrides: Partial<GraphNode> = {}): GraphNode {
  return nixosSharedHostAdmissionPolicyNodeFixture({
    name: "//projects/deployments/pleomino-shared:staging_release",
    allowed_refs: ["env/pleomino/staging"],
    required_checks: ["deploy/pleomino-staging-s3"],
    ...overrides,
  });
}

export function s3StaticLanePolicyNodeFixture(overrides: Partial<GraphNode> = {}): GraphNode {
  return nixosSharedHostLanePolicyNodeFixture(overrides);
}
