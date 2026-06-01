import { validateCredentialMap } from "./cloud-control-credential-map";
import { parseControlPlaneRuntimeConfig } from "./control-plane-runtime-config";
import { validateLiveInputs } from "./control-plane-credential-staging-live";
import { proofWriteExclusivityErrors } from "./control-plane-credential-staging-live-evidence";
import {
  backendRefs,
  hostSourceIds,
  requiredFiles,
  writePlanIds,
} from "./control-plane-credential-staging-helpers";
import type { CredentialStagingInputs } from "./control-plane-credential-staging-inputs";

export function validateCredentialStagingInputs(
  inputs: CredentialStagingInputs,
  live: boolean,
): string[] {
  const config = parseControlPlaneRuntimeConfig(inputs.configText);
  return [
    ...validateCredentialMap(inputs.credentialMap, {
      requiredFiles: requiredFiles(inputs.manifest),
      supabaseProjectRef: inputs.supabaseProfile?.provisioning.projectRef,
      connectionMode: inputs.supabaseProfile?.connection.mode,
      reviewedSourceMode: config.reviewedSource.mode,
    }),
    ...proofWriteExclusivityErrors(
      {
        externalReviewedBackendProof: inputs.externalReviewedBackendProof,
        externalReviewedHostProof: inputs.externalReviewedHostProof,
        deploymentOwnedLiveBackendWrite: inputs.liveBackendWriteEvidence,
      },
      "credential staging",
    ),
    ...validateLiveInputs({
      live,
      backendEvidence: inputs.liveBackendWriteEvidence,
      hostMountEvidence: inputs.liveHostMountEvidence,
      credentialMap: inputs.credentialMap,
      requiredFiles: requiredFiles(inputs.manifest),
      backendRefs: backendRefs(inputs.credentialMap),
      writePlanIds: writePlanIds(inputs.credentialMap),
      hostSourceIds: hostSourceIds(inputs.credentialMap),
      hostVerifierTrustAnchor: inputs.liveHostVerifierTrustAnchor,
    }),
  ];
}

export function externalPrerequisites(inputs: CredentialStagingInputs): string[] {
  const reviewedSource =
    inputs.credentialMap.reviewedSource.mode === "github-app"
      ? "reviewed GitHub App credential provider access"
      : "reviewed SSH credential provider access";
  return ["reviewed secret-backend access", reviewedSource, "live-gated host mount access"];
}

export function nonSecretSemantics(inputs: CredentialStagingInputs): unknown {
  const config = parseControlPlaneRuntimeConfig(inputs.configText);
  return {
    config,
    manifestFiles: requiredFiles(inputs.manifest),
    credentialMapSources: inputs.credentialMap.entries.map((entry) => ({
      file: entry.file,
      kind: (entry.source as any).kind,
    })),
  };
}
