#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REVIEWED_NON_STATIC_COMPONENT_KINDS,
  providerAllowsRoutineProtectedSharedReleaseActionType,
  providerCapabilityFor,
  providerDeclaresReleaseActionType,
  rolloutPolicyOmissionInPolicy,
} from "../../deployments/deployment-provider-capabilities.ts";

test("provider capabilities declare explicit default rollout modes", () => {
  const appStoreConnect = providerCapabilityFor("app-store-connect");
  const googlePlay = providerCapabilityFor("google-play");
  const nixos = providerCapabilityFor("nixos-shared-host");
  const cloudflare = providerCapabilityFor("cloudflare-pages");
  const s3Static = providerCapabilityFor("s3-static");
  const kubernetes = providerCapabilityFor("kubernetes");
  assert.equal(appStoreConnect?.defaultRolloutMode, "all_at_once");
  assert.equal(googlePlay?.defaultRolloutMode, "all_at_once");
  assert.equal(nixos?.defaultRolloutMode, "all_at_once");
  assert.equal(cloudflare?.defaultRolloutMode, "all_at_once");
  assert.equal(s3Static?.defaultRolloutMode, "all_at_once");
  assert.equal(kubernetes?.defaultRolloutMode, "all_at_once");
});

test("rollout policy omission is in policy only for the reviewed deployment shapes", () => {
  assert.equal(
    rolloutPolicyOmissionInPolicy({ provider: "app-store-connect", componentCount: 1 }),
    true,
  );
  assert.equal(rolloutPolicyOmissionInPolicy({ provider: "google-play", componentCount: 1 }), true);
  assert.equal(
    rolloutPolicyOmissionInPolicy({ provider: "nixos-shared-host", componentCount: 1 }),
    true,
  );
  assert.equal(
    rolloutPolicyOmissionInPolicy({ provider: "nixos-shared-host", componentCount: 2 }),
    false,
  );
  assert.equal(
    rolloutPolicyOmissionInPolicy({ provider: "cloudflare-pages", componentCount: 1 }),
    true,
  );
  assert.equal(rolloutPolicyOmissionInPolicy({ provider: "s3-static", componentCount: 1 }), true);
  assert.equal(rolloutPolicyOmissionInPolicy({ provider: "kubernetes", componentCount: 1 }), true);
  assert.equal(
    rolloutPolicyOmissionInPolicy({ provider: "cloudflare-pages", componentCount: 2 }),
    false,
  );
  assert.equal(rolloutPolicyOmissionInPolicy({ provider: "s3-static", componentCount: 2 }), false);
  assert.equal(rolloutPolicyOmissionInPolicy({ provider: "kubernetes", componentCount: 2 }), false);
});

test("provider capabilities make built-in release-action posture explicit", () => {
  assert.equal(providerDeclaresReleaseActionType("nixos-shared-host", "cache_warmup"), true);
  assert.equal(
    providerDeclaresReleaseActionType("nixos-shared-host", "post_publish_verification"),
    true,
  );
  assert.equal(providerDeclaresReleaseActionType("nixos-shared-host", "schema_migration"), true);
  assert.equal(
    providerAllowsRoutineProtectedSharedReleaseActionType("nixos-shared-host", "schema_migration"),
    false,
  );
  assert.equal(providerDeclaresReleaseActionType("cloudflare-pages", "cache_warmup"), false);
  assert.equal(providerDeclaresReleaseActionType("s3-static", "cache_warmup"), false);
  assert.equal(providerDeclaresReleaseActionType("kubernetes", "cache_warmup"), false);
});

test("nixos-shared-host capability declares the reviewed ssr-webapp slice", () => {
  const nixos = providerCapabilityFor("nixos-shared-host");
  assert.deepEqual(nixos?.supportedComponentKinds, ["static-webapp", "ssr-webapp"]);
  assert.deepEqual(nixos?.multiComponentKinds, ["static-webapp"]);
});

test("kubernetes capability declares the reviewed service-style component slice", () => {
  const kubernetes = providerCapabilityFor("kubernetes");
  assert.deepEqual(kubernetes?.supportedComponentKinds, ["service", "third-party-service"]);
  assert.deepEqual(kubernetes?.multiComponentKinds, ["service", "third-party-service"]);
  assert.deepEqual(kubernetes?.supportedRolloutModes, ["all_at_once", "ordered_best_effort"]);
});

test("app-store-connect capability declares the reviewed mobile-app slice", () => {
  const capability = providerCapabilityFor("app-store-connect");
  assert.deepEqual(capability?.supportedComponentKinds, ["mobile-app"]);
  assert.deepEqual(capability?.multiComponentKinds, []);
  assert.deepEqual(capability?.supportedRolloutModes, ["all_at_once", "store_staged"]);
});

test("google-play capability declares the reviewed mobile-app slice", () => {
  const capability = providerCapabilityFor("google-play");
  assert.deepEqual(capability?.supportedComponentKinds, ["mobile-app"]);
  assert.deepEqual(capability?.multiComponentKinds, []);
  assert.deepEqual(capability?.supportedRolloutModes, ["all_at_once", "store_staged"]);
});

test("the reviewed non-static component kinds are available for later provider slices", () => {
  assert.deepEqual(REVIEWED_NON_STATIC_COMPONENT_KINDS, [
    "ssr-webapp",
    "mobile-app",
    "service",
    "third-party-service",
  ]);
});
