#!/usr/bin/env zx-wrapper
import type { DeploymentProviderCapability, ProviderCapabilityBullet } from "./types.ts";

type CapabilitySection =
  | "retryIdempotency"
  | "immutableReuseOperatorFlows"
  | "provisionerSupport"
  | "protectedSharedEligibility";

type RuntimeParitySpec = {
  provider: "s3-static" | "kubernetes";
  expectedBySection: Partial<Record<CapabilitySection, string[]>>;
};

const RUNTIME_PARITY_SPECS: RuntimeParitySpec[] = [
  {
    provider: "s3-static",
    expectedBySection: {
      retryIdempotency: [
        "shared `--publish-only` reuses only an admitted exact artifact selected with `--source-run-id`",
        "same-deployment `--publish-only` is reviewed as `retry`",
        "same-deployment rollback is reviewed only for prior successful normal runs on the same canonical live target identity",
      ],
      immutableReuseOperatorFlows: [
        "same-deployment rollback requires both `--publish-only` and `--rollback`",
        "rollback source selection is limited to prior successful normal live-target runs for the same deployment",
        "retry or rollback fails closed when the retained exact artifact is unavailable",
      ],
      provisionerSupport: [
        "`--provision-only` is reviewed for protected/shared deployments through the control-plane service when the deployment declares one reviewed built-in provisioner",
      ],
      protectedSharedEligibility: [
        "protected/shared mutation, exact-artifact retry or rollback reuse, and reviewed `--provision-only` execution must route through the reviewed control-plane service / worker front door",
      ],
    },
  },
  {
    provider: "kubernetes",
    expectedBySection: {
      retryIdempotency: [
        "shared `--publish-only` reuses only admitted exact component artifacts selected with `--source-run-id`",
        "same-deployment `--publish-only` is reviewed as `retry`",
        "same-deployment rollback is reviewed only for prior successful normal runs on the same canonical release target identity",
      ],
      immutableReuseOperatorFlows: [
        "same-deployment rollback requires both `--publish-only` and `--rollback`",
        "rollback source selection is limited to prior successful normal live-target runs for the same deployment",
        "retry and rollback preserve the recorded release values fingerprint and per-component publish inputs instead of re-resolving ambient workspace state",
      ],
      provisionerSupport: [
        "`--provision-only` is reviewed for protected/shared deployments through the control-plane service when the deployment declares one reviewed built-in provisioner",
      ],
      protectedSharedEligibility: [
        "protected/shared mutation, exact-artifact retry or rollback reuse, and reviewed `--provision-only` execution must route through the reviewed control-plane service / worker front door",
      ],
    },
  },
];

function flattenBulletTexts(bullets: ProviderCapabilityBullet[] | undefined): string[] {
  return (bullets || []).flatMap((entry) => [
    entry.text,
    ...flattenBulletTexts(entry.children || []),
  ]);
}

function sectionTexts(
  capability: DeploymentProviderCapability,
  section: CapabilitySection,
): string[] {
  switch (section) {
    case "retryIdempotency":
      return flattenBulletTexts(capability.retryIdempotency);
    case "immutableReuseOperatorFlows":
      return flattenBulletTexts(capability.immutableReuseOperatorFlows);
    case "provisionerSupport":
      return flattenBulletTexts(capability.provisionerSupport);
    case "protectedSharedEligibility":
      return flattenBulletTexts(capability.protectedSharedEligibility);
  }
}

export function validateReviewedRuntimeParity(opts: {
  provider: RuntimeParitySpec["provider"];
  capability: DeploymentProviderCapability;
}): string[] {
  const spec = RUNTIME_PARITY_SPECS.find((entry) => entry.provider === opts.provider);
  if (!spec) return [];
  const errors: string[] = [];
  for (const [section, expectedTexts] of Object.entries(spec.expectedBySection) as Array<
    [CapabilitySection, string[]]
  >) {
    const actual = sectionTexts(opts.capability, section);
    for (const expected of expectedTexts) {
      if (!actual.includes(expected)) {
        errors.push(
          `${opts.provider}: ${section} must describe reviewed runtime parity: ${expected}`,
        );
      }
    }
  }
  return errors;
}

export function assertReviewedRuntimeParity(opts: {
  provider: RuntimeParitySpec["provider"];
  capability: DeploymentProviderCapability;
}): void {
  const errors = validateReviewedRuntimeParity(opts);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
