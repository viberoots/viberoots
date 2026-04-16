#!/usr/bin/env zx-wrapper
import type { DeploymentProviderCapability, ProviderCapabilityBullet } from "./types.ts";
import {
  reviewedRuntimeParityExpectations,
  type CapabilitySection,
  type ReviewedRuntimeEvidenceProvider,
} from "./runtime-evidence.ts";

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
  provider: ReviewedRuntimeEvidenceProvider;
  capability: DeploymentProviderCapability;
}): string[] {
  const errors: string[] = [];
  const expectedBySection = reviewedRuntimeParityExpectations(opts.provider);
  for (const [section, expectedTexts] of Object.entries(expectedBySection) as Array<
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
  provider: ReviewedRuntimeEvidenceProvider;
  capability: DeploymentProviderCapability;
}): void {
  const errors = validateReviewedRuntimeParity(opts);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
