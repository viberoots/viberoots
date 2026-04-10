#!/usr/bin/env zx-wrapper
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import type { DeploymentAdmissionOperationKind } from "./deployment-admission-binding.ts";
import type { DeploymentAdmissionBinding } from "./deployment-admission-evidence.ts";
import type { DeploymentRunRecordLike } from "./deployment-admission-records.ts";
import type { DeploymentAdmissionPolicy } from "./deployment-policy.ts";
import type {
  DeploymentAttestationEvidence,
  DeploymentAttestationFact,
  DeploymentSbomEvidence,
  DeploymentSbomFact,
  DeploymentSupplyChainGateEvidence,
  DeploymentSupplyChainGateFact,
  DeploymentSupplyChainGateTiming,
} from "./deployment-admission-supply-chain.ts";

type AdmittedContextLike = {
  source: {
    sourceRevision: string;
    artifactIdentity?: string;
  };
};

function carriedPolicyEvaluation(record?: DeploymentRunRecordLike) {
  return record?.admittedContext?.policyEvaluation;
}

function currentAdmissionStages(
  operationKind: DeploymentAdmissionOperationKind,
): DeploymentSupplyChainGateTiming[] {
  return operationKind === "preview" ? ["publish_admission"] : ["publish_admission"];
}

export function evaluateAttestationPolicy(opts: {
  policy: DeploymentAdmissionPolicy;
  binding: DeploymentAdmissionBinding;
  admittedContext: AdmittedContextLike;
  evidence?: DeploymentAttestationEvidence[];
}): DeploymentAttestationFact | undefined {
  const policy = opts.policy.attestation;
  if (!policy) return undefined;
  const artifactIdentity =
    opts.admittedContext.source.artifactIdentity || opts.binding.artifactIdentity || "";
  const sourceRevision =
    opts.admittedContext.source.sourceRevision || opts.binding.sourceRevision || "";
  const hit = (opts.evidence || []).find(
    (entry) =>
      entry.artifactIdentity === artifactIdentity && entry.sourceRevision === sourceRevision,
  );
  if (!hit)
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "protected/shared admission requires artifact attestation evidence",
    );
  if (hit.status !== "verified") {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `artifact attestation is ${hit.status}`,
    );
  }
  if (
    policy.trustedBuilderIdentities.length > 0 &&
    !policy.trustedBuilderIdentities.includes(hit.builderIdentity)
  ) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `artifact attestation builder is untrusted: ${hit.builderIdentity}`,
    );
  }
  if (
    policy.acceptedProvenanceFormats.length > 0 &&
    !policy.acceptedProvenanceFormats.includes(hit.provenanceFormat)
  ) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `artifact attestation provenance format is not accepted: ${hit.provenanceFormat}`,
    );
  }
  if (
    hit.artifactIdentity !== artifactIdentity ||
    hit.sourceRevision !== sourceRevision ||
    (opts.binding.buildInputsFingerprint &&
      hit.buildInputsFingerprint !== opts.binding.buildInputsFingerprint)
  ) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "artifact attestation does not bind to the admitted source revision and build inputs",
    );
  }
  if (policy.signatureRequired) {
    if (hit.signatureStatus !== "verified") {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        "artifact signature verification is required",
      );
    }
    if (
      policy.trustedSignerIdentities.length > 0 &&
      !(hit.signerIdentities || []).some((identity) =>
        policy.trustedSignerIdentities.includes(identity),
      )
    ) {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        "artifact signature signer is untrusted",
      );
    }
  }
  return {
    builderIdentity: hit.builderIdentity,
    provenanceFormat: hit.provenanceFormat,
    artifactIdentity: hit.artifactIdentity,
    sourceRevision: hit.sourceRevision,
    buildInputsFingerprint: hit.buildInputsFingerprint,
    verifiedAt: hit.verifiedAt,
    ...(hit.recordRef ? { recordRef: hit.recordRef } : {}),
    ...(hit.signerIdentities?.length ? { signerIdentities: hit.signerIdentities } : {}),
    ...(hit.signatureStatus ? { signatureStatus: hit.signatureStatus } : {}),
  };
}

export function evaluateSbomPolicy(opts: {
  policy: DeploymentAdmissionPolicy;
  binding: DeploymentAdmissionBinding;
  evidence?: DeploymentSbomEvidence[];
}): DeploymentSbomFact | undefined {
  const policy = opts.policy.sbom;
  if (!policy?.required) return undefined;
  const artifactIdentity = opts.binding.artifactIdentity || "";
  const hit = (opts.evidence || []).find((entry) => entry.artifactIdentity === artifactIdentity);
  if (!hit)
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "protected/shared admission requires SBOM evidence",
    );
  if (hit.status !== "valid") {
    throw new DeploymentAdmissionError("no_longer_admitted", "required SBOM material is invalid");
  }
  if (policy.acceptedFormats.length > 0 && !policy.acceptedFormats.includes(hit.format)) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `required SBOM format is not accepted: ${hit.format}`,
    );
  }
  return {
    artifactIdentity: hit.artifactIdentity,
    format: hit.format,
    verifiedAt: hit.verifiedAt,
    ...(hit.recordRef ? { recordRef: hit.recordRef } : {}),
  };
}

function matchingGate(
  evidence: DeploymentSupplyChainGateEvidence | DeploymentSupplyChainGateFact,
  name: string,
  category: string,
  applyAt: DeploymentSupplyChainGateTiming,
): boolean {
  return evidence.name === name && evidence.category === category && evidence.applyAt === applyAt;
}

export function evaluateSupplyChainGatePolicies(opts: {
  policy: DeploymentAdmissionPolicy;
  operationKind: DeploymentAdmissionOperationKind;
  sourceRecord?: DeploymentRunRecordLike;
  evidence?: DeploymentSupplyChainGateEvidence[];
}): DeploymentSupplyChainGateFact[] {
  const current = (opts.evidence || []).filter((entry) => entry.status === "passed");
  const carried = carriedPolicyEvaluation(opts.sourceRecord)?.supplyChainGates || [];
  const stages = currentAdmissionStages(opts.operationKind);
  const facts: DeploymentSupplyChainGateFact[] = [];
  for (const gate of opts.policy.supplyChainGates) {
    const requiredStages =
      gate.applyAt === "both"
        ? (["build_admission", "publish_admission"] as const)
        : [gate.applyAt];
    for (const stage of requiredStages) {
      if (stage === "publish_admission" && !stages.includes("publish_admission")) continue;
      const pools =
        stage === "build_admission" ? [...current, ...carried] : [...current, ...carried];
      const hit = pools.find((entry) => matchingGate(entry, gate.name, gate.category, stage));
      if (!hit) {
        throw new DeploymentAdmissionError(
          "no_longer_admitted",
          `required supply-chain gate ${gate.name} (${stage}) did not pass`,
        );
      }
      facts.push({
        name: hit.name,
        category: hit.category,
        applyAt: hit.applyAt,
        evaluatedAt: hit.evaluatedAt,
        ...(hit.recordRef ? { recordRef: hit.recordRef } : {}),
      });
    }
  }
  return facts;
}
