#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import { extractGooglePlayDeployments } from "../../deployments/contract.ts";
import {
  googlePlayAdmissionPolicyNodeFixture,
  googlePlayDeploymentNodeFixture,
  googlePlayLanePolicyNodeFixture,
} from "./google-play.fixture.ts";

function componentNode(label: string): GraphNode {
  return { name: label, labels: ["kind:app"] };
}

test("validation rejects unsupported android rollout and provider target shape", () => {
  const { errors } = extractGooglePlayDeployments([
    componentNode("//test-workspace/apps/demo-android:release"),
    googlePlayLanePolicyNodeFixture(),
    googlePlayAdmissionPolicyNodeFixture(),
    googlePlayDeploymentNodeFixture({
      rollout_policy: { mode: "canary", abort: "stop_on_first_failure", smoke: "final_only" },
      provider_target: {
        developer_account: "android-platform",
        app: "demo-android-app",
        package_name: "com.example.demo.android",
        platform: "ios",
        track: "dogfood",
        signing_model: "upload-key",
      },
    }),
  ]);
  assert.ok(
    errors.some((entry) => entry.includes('only supports provider_target.platform "android"')),
  );
  assert.ok(errors.some((entry) => entry.includes("track must be one of")));
  assert.ok(errors.some((entry) => entry.includes("signing_model must be one of")));
  assert.ok(
    errors.some((entry) =>
      entry.includes('only support rollout_policy.mode "all_at_once" or "store_staged"'),
    ),
  );
});

test("validation rejects non-mobile component kinds for google-play", () => {
  const { errors } = extractGooglePlayDeployments([
    componentNode("//test-workspace/apps/demo-android:release"),
    googlePlayLanePolicyNodeFixture(),
    googlePlayAdmissionPolicyNodeFixture(),
    googlePlayDeploymentNodeFixture({ component_kind: "static-webapp" }),
  ]);
  assert.ok(
    errors.some((entry) => entry.includes('does not support component_kind "static-webapp"')),
  );
});
