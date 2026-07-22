#!/usr/bin/env zx-wrapper
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import type { DeploymentAdmissionOperationKind } from "./deployment-admission-binding";
import type { DeploymentAdmissionBinding } from "./deployment-admission-evidence";
import type { DeploymentRunRecordLike } from "./deployment-admission-records";
import type { DeploymentAdmissionPolicy } from "./deployment-policy";
import type {
  DeploymentAttestationEvidence,
  DeploymentAttestationFact,
  DeploymentSbomEvidence,
  DeploymentSbomFact,
  DeploymentSupplyChainGateEvidence,
  DeploymentSupplyChainGateFact,
  DeploymentSupplyChainGateTiming,
} from "./deployment-admission-supply-chain";
import type { ProtectedReproducibilityAggregate } from "../lib/protected-reproducibility-aggregate";
import { REVIEWED_EVIDENCE_SIGNER_IDENTITY } from "../lib/artifact-nix-policy";
import type { DeploymentTarget } from "./contract";
import { artifactDirFromBuiltOutPath } from "./deployment-component-artifact-dirs";
import { artifactIdentityForStaticWebappDir } from "./static-webapp-artifacts";

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

export async function evaluateAttestationPolicy(opts: {
  deployment: DeploymentTarget;
  policy: DeploymentAdmissionPolicy;
  binding: DeploymentAdmissionBinding;
  admittedContext: AdmittedContextLike;
  evidence?: DeploymentAttestationEvidence[];
  protectedAggregateReader?: (
    file: string,
    evidenceStoreLocator: string,
  ) => Promise<ProtectedReproducibilityAggregate>;
  protectedPublicationOutputEnsurer?: (
    outputPath: string,
    evidenceStoreUri: string,
  ) => Promise<void>;
  staticWebappIdentityForOutput?: (outputPath: string) => Promise<string>;
}): Promise<DeploymentAttestationFact | undefined> {
  const policy = opts.policy.attestation;
  if (!policy) return undefined;
  const admittedArtifactIdentity =
    opts.admittedContext.source.artifactIdentity || opts.binding.artifactIdentity || "";
  const admittedSourceRevision =
    opts.admittedContext.source.sourceRevision || opts.binding.sourceRevision || "";
  if ((opts.evidence || []).length !== 1)
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "protected/shared admission requires exactly one publication attestation selection",
    );
  const hit = opts.evidence![0]!;
  const signed = await opts.protectedAggregateReader?.(
    hit.reproducibilityAggregateStorePath,
    hit.evidenceStoreLocator,
  );
  if (!signed) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "protected artifact admission requires a verified signed reproducibility aggregate",
    );
  }
  const comparison = signed.aggregate.publicationComparisons.find(
    (entry) => entry.artifactIdentity.outputPath === hit.publicationOutputPath,
  );
  if (!comparison) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "signed reproducibility aggregate does not bind the selected publication output",
    );
  }
  const subject = comparison.artifactIdentity.subjectAuthority;
  const component = opts.deployment.components.find(
    (entry) => entry.kind === "static-webapp" && entry.target === subject.target,
  );
  if (
    subject.kind !== "publication" ||
    subject.outputRole !== "static-webapp" ||
    !subject.deploymentComponents.includes(opts.deployment.label) ||
    !component
  ) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "signed publication comparison does not authorize this static-webapp deployment",
    );
  }
  if (!opts.protectedPublicationOutputEnsurer) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "protected deployment admission requires canonical publication output staging",
    );
  }
  await opts.protectedPublicationOutputEnsurer(hit.publicationOutputPath, signed.evidenceStoreUri);
  const artifactIdentity = await (opts.staticWebappIdentityForOutput
    ? opts.staticWebappIdentityForOutput(hit.publicationOutputPath)
    : artifactIdentityForStaticWebappDir(
        artifactDirFromBuiltOutPath(component.kind, hit.publicationOutputPath),
      ));
  const builderIdentities = comparison.builderAuthorities.map(({ identity }) => identity) as [
    string,
    string,
  ];
  if (
    policy.trustedBuilderIdentities.length > 0 &&
    builderIdentities.some((identity) => !policy.trustedBuilderIdentities.includes(identity))
  ) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "signed publication comparison contains an untrusted builder",
    );
  }
  if (
    policy.acceptedProvenanceFormats.length > 0 &&
    !policy.acceptedProvenanceFormats.includes("viberoots.hermetic-artifact.v1")
  ) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "artifact attestation provenance format is not accepted: viberoots.hermetic-artifact.v1",
    );
  }
  if (
    artifactIdentity !== admittedArtifactIdentity ||
    signed.aggregate.sourceRevision !== admittedSourceRevision ||
    (opts.binding.buildInputsFingerprint &&
      comparison.artifactIdentityDigest !== opts.binding.buildInputsFingerprint)
  ) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "artifact attestation does not bind to the admitted source revision and build inputs",
    );
  }
  if (
    policy.trustedSignerIdentities.length > 0 &&
    !policy.trustedSignerIdentities.includes(REVIEWED_EVIDENCE_SIGNER_IDENTITY)
  ) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "artifact signature signer is untrusted",
    );
  }
  return {
    builderIdentities,
    provenanceFormat: "viberoots.hermetic-artifact.v1",
    artifactIdentity,
    sourceRevision: signed.aggregate.sourceRevision,
    buildInputsFingerprint: comparison.artifactIdentityDigest,
    verifiedAt: new Date().toISOString(),
    reproducibilityAggregateStorePath: hit.reproducibilityAggregateStorePath,
    publicationOutputPath: hit.publicationOutputPath,
    evidenceStoreLocator: hit.evidenceStoreLocator,
    signatureStatus: "verified",
    signerIdentities: [REVIEWED_EVIDENCE_SIGNER_IDENTITY],
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
