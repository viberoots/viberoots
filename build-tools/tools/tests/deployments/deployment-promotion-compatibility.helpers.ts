#!/usr/bin/env zx-wrapper
import type { promotionCompatibilityErrors } from "../../deployments/deployment-promotion-compatibility";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";

type PromotionSource = Parameters<typeof promotionCompatibilityErrors>[1];

export function sourceFixture(
  overrides: Partial<PromotionSource["replaySnapshot"]["deployment"]> = {},
): PromotionSource {
  const deployment = cloudflarePagesDeploymentFixture({
    ...overrides,
  });
  return sourceForDeployment(deployment, "artifact-compat-123");
}

export function sourceForDeployment(
  deployment: PromotionSource["replaySnapshot"]["deployment"],
  artifactIdentity = "mobile-app:artifact-123",
): PromotionSource {
  return {
    record: {
      finalOutcome: "succeeded",
      publishMode: "normal",
      deploymentId: deployment.deploymentId,
    },
    replaySnapshot: {
      artifact: { identity: artifactIdentity },
      admittedContext: {
        lanePolicyFingerprint: deployment.lanePolicy.fingerprint,
        source: { sourceRevision: "rev-source-123" },
      },
      deployment,
    },
  };
}
