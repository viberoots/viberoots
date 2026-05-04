#!/usr/bin/env zx-wrapper
export type ReviewedRuntimeContractProvider = "s3-static" | "kubernetes" | "vercel";

export type CapabilitySection =
  | "retryIdempotency"
  | "immutableReuseOperatorFlows"
  | "provisionerSupport"
  | "protectedSharedEligibility";

type ExactReuseSurface =
  | "static-webapp-artifact"
  | "service-component-artifacts"
  | "vercel-prebuilt-artifact";
type RollbackIdentityScope = "canonical-live-target-identity" | "canonical-release-target-identity";
type ImmutableReuseGuarantee =
  | "retained-artifact-unavailable-fails-closed"
  | "recorded-release-inputs-preserved";

export type ReviewedRuntimeContract = {
  provider: ReviewedRuntimeContractProvider;
  protectedSharedRequiresControlPlane: true;
  sameDeploymentPublishOnlyClassification: "retry";
  rollbackClassification: "rollback";
  provisionOnlyClassification: "provision_only";
  exactReuseSurface: ExactReuseSurface;
  rollbackIdentityScope: RollbackIdentityScope;
  immutableReuseGuarantee: ImmutableReuseGuarantee;
};

const REVIEWED_RUNTIME_CONTRACTS: Record<ReviewedRuntimeContractProvider, ReviewedRuntimeContract> =
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
    vercel: {
      provider: "vercel",
      protectedSharedRequiresControlPlane: true,
      sameDeploymentPublishOnlyClassification: "retry",
      rollbackClassification: "rollback",
      provisionOnlyClassification: "provision_only",
      exactReuseSurface: "vercel-prebuilt-artifact",
      rollbackIdentityScope: "canonical-live-target-identity",
      immutableReuseGuarantee: "retained-artifact-unavailable-fails-closed",
    },
  };

function retryReuseText(surface: ExactReuseSurface): string {
  if (surface === "static-webapp-artifact") {
    return "shared `--publish-only` reuses only an admitted exact artifact selected with `--source-run-id`";
  }
  if (surface === "vercel-prebuilt-artifact") {
    return "shared `--publish-only` reuses only an admitted exact prebuilt artifact selected with `--source-run-id`";
  }
  return "shared `--publish-only` reuses only admitted exact component artifacts selected with `--source-run-id`";
}

function rollbackIdentityText(scope: RollbackIdentityScope): string {
  return scope === "canonical-live-target-identity"
    ? "same-deployment rollback is reviewed only for prior successful normal runs on the same canonical live target identity"
    : "same-deployment rollback is reviewed only for prior successful normal runs on the same canonical release target identity";
}

function rollbackSourceSelectionText(scope: RollbackIdentityScope): string {
  return scope === "canonical-live-target-identity"
    ? "rollback source selection is limited to prior successful normal live-target runs for the same deployment"
    : "rollback source selection is limited to prior successful normal release-target runs for the same deployment";
}

function immutableReuseText(guarantee: ImmutableReuseGuarantee): string {
  return guarantee === "retained-artifact-unavailable-fails-closed"
    ? "retry or rollback fails closed when the retained exact artifact is unavailable"
    : "retry and rollback preserve the recorded release values fingerprint and per-component publish inputs instead of re-resolving ambient workspace state";
}

export function reviewedRuntimeContractFor(
  provider: ReviewedRuntimeContractProvider,
): ReviewedRuntimeContract {
  return REVIEWED_RUNTIME_CONTRACTS[provider];
}

export function reviewedRuntimeParityExpectationsFromContract(
  contract: ReviewedRuntimeContract,
): Partial<Record<CapabilitySection, string[]>> {
  return {
    retryIdempotency: [
      retryReuseText(contract.exactReuseSurface),
      "same-deployment `--publish-only` is reviewed as `retry`",
      rollbackIdentityText(contract.rollbackIdentityScope),
    ],
    immutableReuseOperatorFlows: [
      "same-deployment rollback requires both `--publish-only` and `--rollback`",
      rollbackSourceSelectionText(contract.rollbackIdentityScope),
      immutableReuseText(contract.immutableReuseGuarantee),
    ],
    provisionerSupport: [
      "`--provision-only` is reviewed for protected/shared deployments through the control-plane service when the deployment declares one reviewed built-in provisioner",
    ],
    protectedSharedEligibility: [
      "protected/shared mutation, exact-artifact retry or rollback reuse, and reviewed `--provision-only` execution must route through the reviewed control-plane service / worker front door",
    ],
  };
}

export function reviewedRuntimeParityExpectationsFor(
  provider: ReviewedRuntimeContractProvider,
): Partial<Record<CapabilitySection, string[]>> {
  return reviewedRuntimeParityExpectationsFromContract(reviewedRuntimeContractFor(provider));
}
