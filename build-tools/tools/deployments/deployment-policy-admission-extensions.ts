#!/usr/bin/env zx-wrapper
import type {
  DeploymentAttestationPolicy,
  DeploymentSbomPolicy,
  DeploymentSupplyChainGatePolicy,
} from "./deployment-admission-supply-chain";

function policyError(ref: string, message: string): string {
  return `${ref}: ${message}`;
}

export function validateAdmissionPolicyExtensions(opts: {
  ref: string;
  attestation?: DeploymentAttestationPolicy;
  supplyChainGates: DeploymentSupplyChainGatePolicy[];
}): string[] {
  const errors: string[] = [];
  if (opts.attestation) {
    if (opts.attestation.artifactBinding !== "source_revision_and_build_inputs") {
      errors.push(
        policyError(opts.ref, `unsupported artifact_binding "${opts.attestation.artifactBinding}"`),
      );
    }
    if (opts.attestation.expiredBehavior !== "fail_closed") {
      errors.push(
        policyError(
          opts.ref,
          `unsupported expired_attestation_behavior "${opts.attestation.expiredBehavior}"`,
        ),
      );
    }
    if (opts.attestation.revokedBehavior !== "fail_closed") {
      errors.push(
        policyError(
          opts.ref,
          `unsupported revoked_attestation_behavior "${opts.attestation.revokedBehavior}"`,
        ),
      );
    }
    if (opts.attestation.trustDriftBehavior !== "fail_closed") {
      errors.push(
        policyError(
          opts.ref,
          `unsupported attestation_trust_drift_behavior "${opts.attestation.trustDriftBehavior}"`,
        ),
      );
    }
  }
  for (const gate of opts.supplyChainGates) {
    if (
      gate.category !== "vulnerability" &&
      gate.category !== "license" &&
      gate.category !== "other"
    ) {
      errors.push(
        policyError(opts.ref, `unsupported supply_chain_gates category "${gate.category}"`),
      );
    }
    if (
      gate.applyAt !== "build_admission" &&
      gate.applyAt !== "publish_admission" &&
      gate.applyAt !== "both"
    ) {
      errors.push(
        policyError(opts.ref, `unsupported supply_chain_gates apply_at "${gate.applyAt}"`),
      );
    }
  }
  return errors;
}

export function admissionPolicyExtensionFingerprintPart(opts: {
  attestation?: DeploymentAttestationPolicy;
  sbom?: DeploymentSbomPolicy;
  supplyChainGates: DeploymentSupplyChainGatePolicy[];
}) {
  return {
    ...(opts.attestation ? { attestation: opts.attestation } : {}),
    ...(opts.sbom ? { sbom: opts.sbom } : {}),
    supplyChainGates: opts.supplyChainGates,
  };
}
