#!/usr/bin/env zx-wrapper
import {
  APP_STORE_CONNECT_PROVIDER,
  MOBILE_APP_COMPONENT_KIND,
  type AppStoreConnectDeployment,
} from "../../deployments/contract";
import type { GraphNode } from "../../lib/graph";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture";

export function appStoreConnectDeploymentFixture(
  overrides: Partial<AppStoreConnectDeployment> = {},
): AppStoreConnectDeployment {
  const environmentStage = overrides.environmentStage || "dev";
  const lanePolicy = overrides.lanePolicy || nixosSharedHostLanePolicyFixture();
  const admissionPolicy =
    overrides.admissionPolicy ||
    nixosSharedHostAdmissionPolicyFixture({
      ref: `//projects/deployments/pleomino-shared:${environmentStage}_release`,
      name: `${environmentStage}_release`,
      requiredChecks: [],
      allowedRefs: [`env/mobile/${environmentStage}`],
      fingerprint: `sha256:admission-mobile-${environmentStage}`,
    });
  const providerTarget = {
    issuer: "ios-platform",
    app: "demo-ios-app",
    bundleId: "com.example.demo",
    platform: "ios" as const,
    track: "testflight-internal" as const,
    signingModel: "app-store" as const,
    providerTargetIdentity: "app-store-connect:ios-platform/demo-ios-app#track:testflight-internal",
    ...(overrides.providerTarget || {}),
  };
  return {
    deploymentId: overrides.deploymentId || "demo-ios-dev",
    label: overrides.label || "//projects/deployments/demo-ios-dev:deploy",
    name: overrides.name || "deploy",
    provider: APP_STORE_CONNECT_PROVIDER,
    protectionClass: overrides.protectionClass || "shared_nonprod",
    lanePolicyRef: overrides.lanePolicyRef || lanePolicy.ref,
    lanePolicy,
    environmentStage,
    admissionPolicyRef: overrides.admissionPolicyRef || admissionPolicy.ref,
    admissionPolicy,
    prerequisites: overrides.prerequisites || [],
    secretRequirements: overrides.secretRequirements || [],
    runtimeConfigRequirements: overrides.runtimeConfigRequirements || [],
    releaseActions: overrides.releaseActions || [],
    targetExceptions: overrides.targetExceptions || [],
    ...(overrides.rolloutPolicy ? { rolloutPolicy: overrides.rolloutPolicy } : {}),
    component: {
      kind: MOBILE_APP_COMPONENT_KIND,
      target: overrides.component?.target || "//projects/apps/demo-ios:release",
    },
    components: overrides.components || [
      {
        id: "default",
        kind: MOBILE_APP_COMPONENT_KIND,
        target: overrides.component?.target || "//projects/apps/demo-ios:release",
      },
    ],
    publisher: overrides.publisher || {
      type: "app-store-connect-mobile-release",
      config: "app-store-connect.jsonc",
    },
    providerTarget,
  };
}

export function appStoreConnectDeploymentNodeFixture(
  overrides: Partial<GraphNode> = {},
): GraphNode {
  return {
    name: "//projects/deployments/demo-ios-dev:deploy",
    provider: "app-store-connect",
    component: "//projects/apps/demo-ios:release",
    component_kind: "mobile-app",
    publisher: "app-store-connect-mobile-release",
    publisher_config: "app-store-connect.jsonc",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/pleomino-shared:lane",
    environment_stage: "dev",
    admission_policy: "//projects/deployments/pleomino-shared:dev_release",
    secret_requirements: [],
    runtime_config_requirements: [],
    provider_target: {
      issuer: "ios-platform",
      app: "demo-ios-app",
      bundle_id: "com.example.demo",
      platform: "ios",
      track: "testflight-internal",
      signing_model: "app-store",
    },
    ...overrides,
  };
}

export function appStoreConnectAdmissionPolicyNodeFixture(
  overrides: Partial<GraphNode> = {},
): GraphNode {
  return nixosSharedHostAdmissionPolicyNodeFixture({
    name: "//projects/deployments/pleomino-shared:dev_release",
    allowed_refs: ["env/mobile/dev"],
    required_checks: [],
    ...overrides,
  });
}

export function appStoreConnectLanePolicyNodeFixture(
  overrides: Partial<GraphNode> = {},
): GraphNode {
  return nixosSharedHostLanePolicyNodeFixture({
    stage_branches: {
      dev: "env/mobile/dev",
      staging: "env/mobile/staging",
      prod: "env/mobile/prod",
    },
    ...overrides,
  });
}
