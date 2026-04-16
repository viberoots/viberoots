#!/usr/bin/env zx-wrapper
export type ReviewedRuntimeEvidenceProvider = "s3-static" | "kubernetes";

export type CapabilitySection =
  | "retryIdempotency"
  | "immutableReuseOperatorFlows"
  | "provisionerSupport"
  | "protectedSharedEligibility";

type ExactReuseSurface = "static-webapp-artifact" | "service-component-artifacts";
type RollbackIdentityScope = "canonical-live-target-identity" | "canonical-release-target-identity";
type ImmutableReuseGuarantee =
  | "retained-artifact-unavailable-fails-closed"
  | "recorded-release-inputs-preserved";

export type ReviewedRuntimeEvidence = {
  provider: ReviewedRuntimeEvidenceProvider;
  protectedSharedRequiresControlPlane: true;
  sameDeploymentPublishOnlyClassification: "retry";
  rollbackClassification: "rollback";
  provisionOnlyClassification: "provision_only";
  exactReuseSurface: ExactReuseSurface;
  rollbackIdentityScope: RollbackIdentityScope;
  immutableReuseGuarantee: ImmutableReuseGuarantee;
};

const REVIEWED_RUNTIME_EVIDENCE: Record<ReviewedRuntimeEvidenceProvider, ReviewedRuntimeEvidence> =
  {
    "s3-static": {
      provider: "s3-static",
      protectedSharedRequiresControlPlane: true,
      sameDeploymentPublishOnlyClassification: "retry",
      rollbackClassification: "rollback",
      provisionOnlyClassification: "provision_only",
      exactReuseSurface: "static-webapp-artifact",
      rollbackIdentityScope: "canonical-live-target-identity",
      immutableReuseGuarantee: "retained-artifact-unavailable-fails-closed",
    },
    kubernetes: {
      provider: "kubernetes",
      protectedSharedRequiresControlPlane: true,
      sameDeploymentPublishOnlyClassification: "retry",
      rollbackClassification: "rollback",
      provisionOnlyClassification: "provision_only",
      exactReuseSurface: "service-component-artifacts",
      rollbackIdentityScope: "canonical-release-target-identity",
      immutableReuseGuarantee: "recorded-release-inputs-preserved",
    },
  };

function retryReuseText(surface: ExactReuseSurface): string {
  return surface === "static-webapp-artifact"
    ? "shared `--publish-only` reuses only an admitted exact artifact selected with `--source-run-id`"
    : "shared `--publish-only` reuses only admitted exact component artifacts selected with `--source-run-id`";
}

function rollbackIdentityText(scope: RollbackIdentityScope): string {
  return scope === "canonical-live-target-identity"
    ? "same-deployment rollback is reviewed only for prior successful normal runs on the same canonical live target identity"
    : "same-deployment rollback is reviewed only for prior successful normal runs on the same canonical release target identity";
}

function immutableReuseText(guarantee: ImmutableReuseGuarantee): string {
  return guarantee === "retained-artifact-unavailable-fails-closed"
    ? "retry or rollback fails closed when the retained exact artifact is unavailable"
    : "retry and rollback preserve the recorded release values fingerprint and per-component publish inputs instead of re-resolving ambient workspace state";
}

export function reviewedRuntimeEvidenceFor(
  provider: ReviewedRuntimeEvidenceProvider,
): ReviewedRuntimeEvidence {
  return REVIEWED_RUNTIME_EVIDENCE[provider];
}

export function reviewedRuntimeParityExpectations(
  provider: ReviewedRuntimeEvidenceProvider,
): Partial<Record<CapabilitySection, string[]>> {
  const evidence = reviewedRuntimeEvidenceFor(provider);
  return {
    retryIdempotency: [
      retryReuseText(evidence.exactReuseSurface),
      "same-deployment `--publish-only` is reviewed as `retry`",
      rollbackIdentityText(evidence.rollbackIdentityScope),
    ],
    immutableReuseOperatorFlows: [
      "same-deployment rollback requires both `--publish-only` and `--rollback`",
      "rollback source selection is limited to prior successful normal live-target runs for the same deployment",
      immutableReuseText(evidence.immutableReuseGuarantee),
    ],
    provisionerSupport: [
      "`--provision-only` is reviewed for protected/shared deployments through the control-plane service when the deployment declares one reviewed built-in provisioner",
    ],
    protectedSharedEligibility: [
      "protected/shared mutation, exact-artifact retry or rollback reuse, and reviewed `--provision-only` execution must route through the reviewed control-plane service / worker front door",
    ],
  };
}
