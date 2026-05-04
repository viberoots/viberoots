#!/usr/bin/env zx-wrapper
import { DEPLOYMENT_ROLLOUT_MODES } from "../deployment-rollout";
import { validateCapabilityFrontDoorContract } from "./front-door-contract";
import type { DeploymentProviderCapability, ProviderCapabilityBullet } from "./types";

function pushWhenEmpty(
  errors: string[],
  provider: string,
  label: string,
  values: readonly unknown[] | undefined,
) {
  if (!values || values.length === 0) {
    errors.push(`${provider}: ${label} must not be empty`);
  }
}

function validateBullets(
  errors: string[],
  provider: string,
  label: string,
  bullets: ProviderCapabilityBullet[] | undefined,
) {
  pushWhenEmpty(errors, provider, label, bullets);
  for (const [index, entry] of (bullets || []).entries()) {
    if (!entry.text.trim()) {
      errors.push(`${provider}: ${label}[${index}] must not be blank`);
    }
    if (entry.children) {
      validateBullets(errors, provider, `${label}[${index}].children`, entry.children);
    }
  }
}

export function validateCapability(
  provider: string,
  capability: DeploymentProviderCapability,
): string[] {
  const errors: string[] = [];
  if (provider !== capability.provider) {
    errors.push(`${provider}: registry key must match capability.provider`);
  }
  pushWhenEmpty(errors, provider, "supportedComponentKinds", capability.supportedComponentKinds);
  for (const kind of capability.multiComponentKinds) {
    if (!capability.supportedComponentKinds.includes(kind)) {
      errors.push(`${provider}: multiComponentKinds must be a subset of supportedComponentKinds`);
      break;
    }
  }
  pushWhenEmpty(errors, provider, "supportedRolloutModes", capability.supportedRolloutModes);
  if (!capability.supportedRolloutModes.includes(capability.defaultRolloutMode)) {
    errors.push(`${provider}: defaultRolloutMode must appear in supportedRolloutModes`);
  }
  for (const mode of capability.supportedRolloutModes) {
    if (!DEPLOYMENT_ROLLOUT_MODES.has(mode)) {
      errors.push(`${provider}: unsupported rollout mode "${mode}" in supportedRolloutModes`);
    }
  }
  for (const mode of capability.rolloutSupport.unsupportedModes || []) {
    if (!DEPLOYMENT_ROLLOUT_MODES.has(mode)) {
      errors.push(
        `${provider}: unsupported rollout mode "${mode}" in rolloutSupport.unsupportedModes`,
      );
    }
    if (capability.supportedRolloutModes.includes(mode)) {
      errors.push(`${provider}: unsupported rollout modes must not also be supported`);
    }
  }
  pushWhenEmpty(
    errors,
    provider,
    "canonicalTargetIdentity.fields",
    capability.canonicalTargetIdentity.fields,
  );
  validateBullets(
    errors,
    provider,
    "canonicalTargetIdentity.lockKeyShape",
    capability.canonicalTargetIdentity.lockKeyShape,
  );
  if (capability.canonicalTargetIdentity.requiredReviewedProviderTargetFields) {
    validateBullets(
      errors,
      provider,
      "canonicalTargetIdentity.requiredReviewedProviderTargetFields",
      capability.canonicalTargetIdentity.requiredReviewedProviderTargetFields,
    );
  }
  if (capability.canonicalTargetIdentity.requiredNormalizedDerivedFields) {
    validateBullets(
      errors,
      provider,
      "canonicalTargetIdentity.requiredNormalizedDerivedFields",
      capability.canonicalTargetIdentity.requiredNormalizedDerivedFields,
    );
  }
  validateBullets(
    errors,
    provider,
    "componentSupport.reviewedMultiComponentSupport",
    capability.componentSupport.reviewedMultiComponentSupport,
  );
  validateBullets(
    errors,
    provider,
    "rolloutPolicyOmissionInPolicy.reviewedPosture",
    capability.rolloutPolicyOmissionInPolicy.reviewedPosture,
  );
  validateBullets(errors, provider, "previewSupport.support", capability.previewSupport.support);
  if (capability.previewSupport.isolationModel) {
    validateBullets(
      errors,
      provider,
      "previewSupport.isolationModel",
      capability.previewSupport.isolationModel,
    );
  }
  if (capability.previewSupport.cleanupDefault) {
    validateBullets(
      errors,
      provider,
      "previewSupport.cleanupDefault",
      capability.previewSupport.cleanupDefault,
    );
  }
  if (capability.previewSupport.lockScopeDefault) {
    validateBullets(
      errors,
      provider,
      "previewSupport.lockScopeDefault",
      capability.previewSupport.lockScopeDefault,
    );
  }
  validateBullets(
    errors,
    provider,
    "smokeReleaseHealth.defaultSmokeModel",
    capability.smokeReleaseHealth.defaultSmokeModel,
  );
  pushWhenEmpty(
    errors,
    provider,
    "builtInPublisherContract.publisherTypes",
    capability.builtInPublisherContract.publisherTypes,
  );
  if (capability.builtInPublisherContract.exactPublishInput) {
    validateBullets(
      errors,
      provider,
      "builtInPublisherContract.exactPublishInput",
      capability.builtInPublisherContract.exactPublishInput,
    );
  }
  if (capability.builtInPublisherContract.checkedInProviderConfig) {
    validateBullets(
      errors,
      provider,
      "builtInPublisherContract.checkedInProviderConfig",
      capability.builtInPublisherContract.checkedInProviderConfig,
    );
  }
  if (capability.builtInPublisherContract.accountSelection) {
    validateBullets(
      errors,
      provider,
      "builtInPublisherContract.accountSelection",
      capability.builtInPublisherContract.accountSelection,
    );
  }
  if (capability.builtInPublisherContract.additionalFacts) {
    validateBullets(
      errors,
      provider,
      "builtInPublisherContract.additionalFacts",
      capability.builtInPublisherContract.additionalFacts,
    );
  }
  validateBullets(errors, provider, "retryIdempotency", capability.retryIdempotency);
  if (capability.replaySnapshotBaseline) {
    validateBullets(errors, provider, "replaySnapshotBaseline", capability.replaySnapshotBaseline);
  }
  if (capability.immutableReuseOperatorFlows) {
    validateBullets(
      errors,
      provider,
      "immutableReuseOperatorFlows",
      capability.immutableReuseOperatorFlows,
    );
  }
  if (capability.promotionCompatibility) {
    validateBullets(errors, provider, "promotionCompatibility", capability.promotionCompatibility);
  }
  if (capability.targetTransitionSupport) {
    validateBullets(
      errors,
      provider,
      "targetTransitionSupport",
      capability.targetTransitionSupport,
    );
  }
  validateBullets(
    errors,
    provider,
    "partialPublishObservability",
    capability.partialPublishObservability,
  );
  validateBullets(errors, provider, "provisionerSupport", capability.provisionerSupport);
  validateBullets(
    errors,
    provider,
    "releaseActions.reviewedSupport",
    capability.releaseActions.reviewedSupport,
  );
  if (!capability.releaseActions.supportsProtectedShared) {
    if (capability.releaseActions.declaredTypes.length > 0) {
      errors.push(
        `${provider}: releaseActions.declaredTypes must be empty when support is disabled`,
      );
    }
    if (capability.releaseActions.routineAllowedTypes.length > 0) {
      errors.push(
        `${provider}: releaseActions.routineAllowedTypes must be empty when support is disabled`,
      );
    }
  }
  for (const type of capability.releaseActions.routineAllowedTypes) {
    if (!capability.releaseActions.declaredTypes.includes(type)) {
      errors.push(`${provider}: routineAllowedTypes must be a subset of declaredTypes`);
      break;
    }
  }
  validateBullets(
    errors,
    provider,
    "protectedSharedEligibility",
    capability.protectedSharedEligibility,
  );
  for (const section of capability.additionalSections || []) {
    if (!section.title.trim()) {
      errors.push(`${provider}: additional section title must not be blank`);
      continue;
    }
    validateBullets(errors, provider, `additionalSections.${section.title}`, section.bullets);
  }
  errors.push(...validateCapabilityFrontDoorContract(provider, capability));
  return errors;
}
