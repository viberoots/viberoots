#!/usr/bin/env zx-wrapper
import type { DeploymentComponentKind } from "../deployment-component-kinds";
import type { DeploymentRolloutMode } from "../deployment-rollout";

export type ProviderCapabilityBullet = {
  text: string;
  children?: ProviderCapabilityBullet[];
};

export function bullet(
  text: string,
  children: ProviderCapabilityBullet[] = [],
): ProviderCapabilityBullet {
  return children.length > 0 ? { text, children } : { text };
}

export type ReleaseActionsCapability = {
  supportsProtectedShared: boolean;
  declaredTypes: string[];
  routineAllowedTypes: string[];
  reviewedSupport: ProviderCapabilityBullet[];
};

export type DeploymentProviderCapability = {
  provider: string;
  supportedComponentKinds: DeploymentComponentKind[];
  multiComponentKinds: DeploymentComponentKind[];
  supportedRolloutModes: DeploymentRolloutMode[];
  defaultRolloutMode: DeploymentRolloutMode;
  canonicalTargetIdentity: {
    fields: string[];
    lockKeyShape: ProviderCapabilityBullet[];
    requiredReviewedProviderTargetFields?: ProviderCapabilityBullet[];
    requiredNormalizedDerivedFields?: ProviderCapabilityBullet[];
  };
  componentSupport: {
    reviewedMultiComponentSupport: ProviderCapabilityBullet[];
    additionalUnsupportedShapes?: string[];
  };
  rolloutPolicyOmissionInPolicy: {
    singleComponent: boolean;
    multiComponent: boolean;
    reviewedPosture: ProviderCapabilityBullet[];
  };
  rolloutSupport: {
    unsupportedModes?: DeploymentRolloutMode[];
    reviewedStagedRolloutPosture?: ProviderCapabilityBullet[];
    reviewedMultiComponentPosture?: ProviderCapabilityBullet[];
  };
  previewSupport: {
    support: ProviderCapabilityBullet[];
    isolationModel?: ProviderCapabilityBullet[];
    cleanupDefault?: ProviderCapabilityBullet[];
    lockScopeDefault?: ProviderCapabilityBullet[];
    requiredGuarantees?: string[];
  };
  smokeReleaseHealth: {
    defaultSmokeModel: ProviderCapabilityBullet[];
    previewOverride?: ProviderCapabilityBullet[];
  };
  builtInPublisherContract: {
    publisherTypes: string[];
    exactPublishInput?: ProviderCapabilityBullet[];
    checkedInProviderConfig?: ProviderCapabilityBullet[];
    accountSelection?: ProviderCapabilityBullet[];
    additionalFacts?: ProviderCapabilityBullet[];
  };
  retryIdempotency: ProviderCapabilityBullet[];
  replaySnapshotBaseline?: ProviderCapabilityBullet[];
  immutableReuseOperatorFlows?: ProviderCapabilityBullet[];
  promotionCompatibility?: ProviderCapabilityBullet[];
  targetTransitionSupport?: ProviderCapabilityBullet[];
  partialPublishObservability: ProviderCapabilityBullet[];
  provisionerSupport: ProviderCapabilityBullet[];
  releaseActions: ReleaseActionsCapability;
  protectedSharedEligibility: ProviderCapabilityBullet[];
  additionalSections?: Array<{
    title: string;
    bullets: ProviderCapabilityBullet[];
  }>;
};
