#!/usr/bin/env zx-wrapper
import {
  GOOGLE_PLAY_PROVIDER,
  MOBILE_APP_COMPONENT_KIND,
  type GooglePlayDeployment,
} from "../../deployments/contract.ts";
import type { GraphNode } from "../../lib/graph.ts";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture.ts";

export function googlePlayDeploymentFixture(
  overrides: Partial<GooglePlayDeployment> = {},
): GooglePlayDeployment {
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
    developerAccount: "android-platform",
    app: "demo-android-app",
    packageName: "com.example.demo.android",
    platform: "android" as const,
    track: "internal" as const,
    signingModel: "play-app-signing" as const,
    providerTargetIdentity: "google-play:android-platform/demo-android-app#track:internal",
    ...(overrides.providerTarget || {}),
  };
  return {
    deploymentId: overrides.deploymentId || "demo-android-dev",
    label: overrides.label || "//projects/deployments/demo-android-dev:deploy",
    name: overrides.name || "deploy",
    provider: GOOGLE_PLAY_PROVIDER,
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
      target: overrides.component?.target || "//projects/apps/demo-android:release",
    },
    components: overrides.components || [
      {
        id: "default",
        kind: MOBILE_APP_COMPONENT_KIND,
        target: overrides.component?.target || "//projects/apps/demo-android:release",
      },
    ],
    publisher: overrides.publisher || {
      type: "google-play-mobile-release",
      config: "google-play.jsonc",
    },
    providerTarget,
  };
}

export function googlePlayDeploymentNodeFixture(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/deployments/demo-android-dev:deploy",
    provider: "google-play",
    component: "//projects/apps/demo-android:release",
    component_kind: "mobile-app",
    publisher: "google-play-mobile-release",
    publisher_config: "google-play.jsonc",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/pleomino-shared:lane",
    environment_stage: "dev",
    admission_policy: "//projects/deployments/pleomino-shared:dev_release",
    secret_requirements: [],
    runtime_config_requirements: [],
    provider_target: {
      developer_account: "android-platform",
      app: "demo-android-app",
      package_name: "com.example.demo.android",
      platform: "android",
      track: "internal",
      signing_model: "play-app-signing",
    },
    ...overrides,
  };
}

export function googlePlayAdmissionPolicyNodeFixture(
  overrides: Partial<GraphNode> = {},
): GraphNode {
  return nixosSharedHostAdmissionPolicyNodeFixture({
    name: "//projects/deployments/pleomino-shared:dev_release",
    allowed_refs: ["env/mobile/dev"],
    required_checks: [],
    ...overrides,
  });
}

export function googlePlayLanePolicyNodeFixture(overrides: Partial<GraphNode> = {}): GraphNode {
  return nixosSharedHostLanePolicyNodeFixture({
    stage_branches: {
      dev: "env/mobile/dev",
      staging: "env/mobile/staging",
      prod: "env/mobile/prod",
    },
    ...overrides,
  });
}
