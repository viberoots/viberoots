#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import { extractAppStoreConnectDeployments } from "../../deployments/contract.ts";
import {
  appStoreConnectAdmissionPolicyNodeFixture,
  appStoreConnectDeploymentNodeFixture,
  appStoreConnectLanePolicyNodeFixture,
} from "./app-store-connect.fixture.ts";

function componentNode(label: string): GraphNode {
  return { name: label, labels: ["kind:app"] };
}

test("validation rejects unsupported mobile rollout and provider target shape", () => {
  const { errors } = extractAppStoreConnectDeployments([
    componentNode("//projects/apps/demo-ios:release"),
    appStoreConnectLanePolicyNodeFixture(),
    appStoreConnectAdmissionPolicyNodeFixture(),
    appStoreConnectDeploymentNodeFixture({
      rollout_policy: { mode: "canary", abort: "stop_on_first_failure", smoke: "final_only" },
      provider_target: {
        issuer: "ios-platform",
        app: "demo-ios-app",
        bundle_id: "com.example.demo",
        platform: "android",
        track: "beta",
        signing_model: "enterprise",
      },
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes('only supports provider_target.platform "ios"')));
  assert.ok(errors.some((entry) => entry.includes("track must be one of")));
  assert.ok(errors.some((entry) => entry.includes("signing_model must be one of")));
  assert.ok(
    errors.some((entry) =>
      entry.includes('only support rollout_policy.mode "all_at_once" or "store_staged"'),
    ),
  );
});

test("validation rejects non-mobile component kinds for app-store-connect", () => {
  const { errors } = extractAppStoreConnectDeployments([
    componentNode("//projects/apps/demo-ios:release"),
    appStoreConnectLanePolicyNodeFixture(),
    appStoreConnectAdmissionPolicyNodeFixture(),
    appStoreConnectDeploymentNodeFixture({ component_kind: "static-webapp" }),
  ]);
  assert.ok(
    errors.some((entry) => entry.includes('does not support component_kind "static-webapp"')),
  );
});
