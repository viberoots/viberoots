#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { promotionCompatibilityErrors } from "../../deployments/deployment-promotion-compatibility";
import { appStoreConnectDeploymentFixture } from "./app-store-connect.fixture";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { sourceFixture, sourceForDeployment } from "./deployment-promotion-compatibility.helpers";
import { googlePlayDeploymentFixture } from "./google-play.fixture";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";

test("promotion compatibility rejects provider and publisher drift", () => {
  const target = nixosSharedHostDeploymentFixture({
    environmentStage: "staging",
    admissionPolicy: nixosSharedHostAdmissionPolicyFixture({
      ref: "//projects/deployments/sample-webapp/shared:staging_release",
      name: "staging_release",
      allowedRefs: ["main"],
      requiredChecks: [],
    }),
  });
  const errors = promotionCompatibilityErrors(target, sourceFixture());
  assert.ok(errors.some((entry) => entry.includes("provider mismatch")));
  assert.ok(errors.some((entry) => entry.includes("publisher type mismatch")));
});

test("promotion compatibility allows reviewed cross-provider dev promotion on declared edges", () => {
  const lanePolicy = {
    ...cloudflarePagesDeploymentFixture().lanePolicy,
    promotionCompatibility: {
      crossProviderPromotionEdges: ["dev->staging"],
    },
  };
  const sourceDeployment = nixosSharedHostDeploymentFixture({
    deploymentId: "sample-webapp-dev",
    label: "//projects/deployments/sample-webapp/dev:deploy",
    lanePolicy,
    lanePolicyRef: lanePolicy.ref,
    component: { kind: "static-webapp", target: "//projects/apps/sample-webapp:app" },
    runtime: { appName: "sample-webapp", containerPort: 3000, healthPath: "/healthz" },
  });
  const target = cloudflarePagesDeploymentFixture({
    lanePolicy,
    lanePolicyRef: lanePolicy.ref,
    component: { kind: "static-webapp", target: "//projects/apps/sample-webapp:app" },
  });
  const errors = promotionCompatibilityErrors(target, sourceForDeployment(sourceDeployment));
  assert.deepEqual(errors, []);
});

test("promotion compatibility rejects rollout-semantics drift", () => {
  const source = sourceFixture({
    rolloutPolicy: {
      mode: "all_at_once",
      abort: "stop_on_first_failure",
      smoke: "final_only",
      steps: [],
    },
  });
  const target = cloudflarePagesDeploymentFixture();
  const errors = promotionCompatibilityErrors(target, source);
  assert.ok(errors.some((entry) => entry.includes("rollout semantics mismatch")));
});

test("promotion compatibility rejects provisioner drift inside one lane", () => {
  const source = {
    ...sourceFixture(),
    replaySnapshot: {
      ...sourceFixture().replaySnapshot,
      deployment: nixosSharedHostDeploymentFixture({
        environmentStage: "dev",
        provisioner: { type: "nixos-shared-host-manifest" },
      }),
    },
  };
  const target = nixosSharedHostDeploymentFixture({
    environmentStage: "staging",
    admissionPolicy: nixosSharedHostAdmissionPolicyFixture({
      ref: "//projects/deployments/sample-webapp/shared:staging_release",
      name: "staging_release",
      allowedRefs: ["main"],
      requiredChecks: [],
    }),
    provisioner: { type: "custom-provisioner" },
  });
  const errors = promotionCompatibilityErrors(target, source);
  assert.ok(errors.some((entry) => entry.includes("provisioner mismatch")));
});

test("promotion compatibility rejects SSR runtime-contract drift inside one lane", () => {
  const sourceDeployment = nixosSharedHostDeploymentFixture({
    component: { kind: "ssr-webapp", target: "//projects/apps/demoapp:app" },
  });
  const target = nixosSharedHostDeploymentFixture({
    environmentStage: "staging",
    component: { kind: "ssr-webapp", target: "//projects/apps/demoapp:app" },
    runtime: {
      ...sourceDeployment.runtime!,
      runtimeContract: {
        ...(sourceDeployment.runtime as any).runtimeContract,
        framework: "next",
      },
    } as any,
    admissionPolicy: nixosSharedHostAdmissionPolicyFixture({
      ref: "//projects/deployments/sample-webapp/shared:staging_release",
      name: "staging_release",
      allowedRefs: ["main"],
      requiredChecks: [],
    }),
  });
  const errors = promotionCompatibilityErrors(target, sourceForDeployment(sourceDeployment));
  assert.ok(errors.some((entry) => entry.includes("runtime contract mismatch")));
});

test("promotion compatibility rejects mobile signing-model drift", () => {
  const sourceDeployment = appStoreConnectDeploymentFixture();
  const target = appStoreConnectDeploymentFixture({
    deploymentId: "demo-ios-staging",
    label: "//projects/deployments/demo-ios-staging:deploy",
    environmentStage: "staging",
    providerTarget: {
      ...sourceDeployment.providerTarget,
      track: "testflight-external",
      signingModel: "app-store",
      providerTargetIdentity:
        "app-store-connect:ios-platform/demo-ios-app#track:testflight-external",
    },
  });
  const errors = promotionCompatibilityErrors(
    target,
    sourceForDeployment({
      ...sourceDeployment,
      providerTarget: { ...sourceDeployment.providerTarget, signingModel: "enterprise" as any },
    }),
  );
  assert.ok(errors.some((entry) => entry.includes("signing model mismatch")));
});

test("promotion compatibility rejects mobile track regression", () => {
  const sourceDeployment = appStoreConnectDeploymentFixture({
    deploymentId: "demo-ios-staging",
    label: "//projects/deployments/demo-ios-staging:deploy",
    environmentStage: "staging",
    providerTarget: {
      issuer: "ios-platform",
      app: "demo-ios-app",
      bundleId: "com.example.demo",
      platform: "ios",
      track: "testflight-external",
      signingModel: "app-store",
      providerTargetIdentity:
        "app-store-connect:ios-platform/demo-ios-app#track:testflight-external",
    },
  });
  const target = appStoreConnectDeploymentFixture({
    providerTarget: {
      issuer: "ios-platform",
      app: "demo-ios-app",
      bundleId: "com.example.demo",
      platform: "ios",
      track: "testflight-internal",
      signingModel: "app-store",
      providerTargetIdentity:
        "app-store-connect:ios-platform/demo-ios-app#track:testflight-internal",
    },
  });
  const errors = promotionCompatibilityErrors(target, sourceForDeployment(sourceDeployment));
  assert.ok(errors.some((entry) => entry.includes("mobile track progression mismatch")));
});

test("promotion compatibility rejects google-play rollout regression", () => {
  const sourceDeployment = googlePlayDeploymentFixture({
    deploymentId: "demo-android-staging",
    label: "//projects/deployments/demo-android-staging:deploy",
    environmentStage: "staging",
    rolloutPolicy: {
      mode: "store_staged",
      abort: "stop_on_first_failure",
      smoke: "final_only",
      steps: ["default"],
    },
    providerTarget: {
      developerAccount: "android-platform",
      app: "demo-android-app",
      packageName: "com.example.demo.android",
      platform: "android",
      track: "beta",
      signingModel: "play-app-signing",
      providerTargetIdentity: "google-play:android-platform/demo-android-app#track:beta",
    },
  });
  const target = googlePlayDeploymentFixture({
    providerTarget: {
      developerAccount: "android-platform",
      app: "demo-android-app",
      packageName: "com.example.demo.android",
      platform: "android",
      track: "production",
      signingModel: "play-app-signing",
      providerTargetIdentity: "google-play:android-platform/demo-android-app#track:production",
    },
  });
  const errors = promotionCompatibilityErrors(target, sourceForDeployment(sourceDeployment));
  assert.ok(errors.some((entry) => entry.includes("mobile rollout progression mismatch")));
});

test("promotion compatibility rejects google-play track regression", () => {
  const sourceDeployment = googlePlayDeploymentFixture({
    deploymentId: "demo-android-staging",
    label: "//projects/deployments/demo-android-staging:deploy",
    environmentStage: "staging",
    providerTarget: {
      developerAccount: "android-platform",
      app: "demo-android-app",
      packageName: "com.example.demo.android",
      platform: "android",
      track: "beta",
      signingModel: "play-app-signing",
      providerTargetIdentity: "google-play:android-platform/demo-android-app#track:beta",
    },
  });
  const target = googlePlayDeploymentFixture();
  const errors = promotionCompatibilityErrors(target, sourceForDeployment(sourceDeployment));
  assert.ok(errors.some((entry) => entry.includes("mobile track progression mismatch")));
});
