#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertVerifyTargetPlanNotEmpty } from "../../dev/verify/target-passes";

test("verify fails fast when explicit selectors resolve to zero concrete targets", () => {
  assert.throws(
    () =>
      assertVerifyTargetPlanNotEmpty({
        requestedTargets: ["//projects/apps/missing:unit"],
        plan: {
          targetLabels: [],
          passes: [],
        },
      }),
    /zero concrete Buck test targets/,
  );
});

test("verify allows non-empty target plans", () => {
  assert.doesNotThrow(() =>
    assertVerifyTargetPlanNotEmpty({
      requestedTargets: ["//:deployments_nixos_shared_host_deploy_remote_exec"],
      plan: {
        targetLabels: [
          {
            target: "//:deployments_nixos_shared_host_deploy_remote_exec",
            labels: [],
          },
        ],
        passes: [
          {
            name: "shared",
            targets: ["//:deployments_nixos_shared_host_deploy_remote_exec"],
          },
        ],
      },
    }),
  );
});

test("verify allows empty broad selector scans", () => {
  assert.doesNotThrow(() =>
    assertVerifyTargetPlanNotEmpty({
      requestedTargets: ["//..."],
      plan: {
        targetLabels: [],
        passes: [],
      },
    }),
  );
});

test("verify allows empty package selector scans", () => {
  assert.doesNotThrow(() =>
    assertVerifyTargetPlanNotEmpty({
      requestedTargets: ["//projects/..."],
      plan: {
        targetLabels: [],
        passes: [],
      },
    }),
  );
});
