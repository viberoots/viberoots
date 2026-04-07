#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { promotionCompatibilityErrors } from "../../deployments/deployment-promotion-compatibility.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";

function sourceFixture(
  overrides: Partial<
    Parameters<typeof promotionCompatibilityErrors>[1]["replaySnapshot"]["deployment"]
  > = {},
) {
  const deployment = cloudflarePagesDeploymentFixture({
    ...overrides,
  });
  return {
    record: {
      finalOutcome: "succeeded",
      publishMode: "normal",
      deploymentId: deployment.deploymentId,
    },
    replaySnapshot: {
      artifact: { identity: "artifact-compat-123" },
      admittedContext: {
        lanePolicyFingerprint: deployment.lanePolicy.fingerprint,
        source: { sourceRevision: "rev-source-123" },
      },
      deployment,
    },
  };
}

test("promotion compatibility rejects provider and publisher drift", () => {
  const target = nixosSharedHostDeploymentFixture({
    environmentStage: "staging",
    admissionPolicy: nixosSharedHostAdmissionPolicyFixture({
      ref: "//projects/deployments/pleomino-shared:staging_release",
      name: "staging_release",
      allowedRefs: ["env/pleomino/staging"],
      requiredChecks: [],
    }),
  });
  const errors = promotionCompatibilityErrors(target, sourceFixture());
  assert.ok(errors.some((entry) => entry.includes("provider mismatch")));
  assert.ok(errors.some((entry) => entry.includes("publisher type mismatch")));
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
      ref: "//projects/deployments/pleomino-shared:staging_release",
      name: "staging_release",
      allowedRefs: ["env/pleomino/staging"],
      requiredChecks: [],
    }),
    provisioner: { type: "custom-provisioner" },
  });
  const errors = promotionCompatibilityErrors(target, source);
  assert.ok(errors.some((entry) => entry.includes("provisioner mismatch")));
});
