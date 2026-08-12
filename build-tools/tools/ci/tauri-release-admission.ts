import { REVIEWED_EVIDENCE_SIGNER_IDENTITY } from "../lib/artifact-nix-policy";
import {
  isVerifiedTauriQualification,
  isVerifiedTauriReleaseEvidence,
  type VerifiedTauriReleaseEvidence,
} from "./tauri-release-evidence-reader";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const REVISION = /^[a-f0-9]{40,64}$/u;
const STORE_FILE = /^\/nix\/store\/[a-z0-9]{32}-[^/]+\/[^/]+\.json$/u;

export type TauriQualifiedArtifact = {
  matrixId: "rust-tauri-darwin-pr12";
  languageStatus: "candidate" | "graduated";
  qualificationAggregateStorePath: string;
  evidenceSignerIdentity: typeof REVIEWED_EVIDENCE_SIGNER_IDENTITY;
  sourceRevision: string;
  toolSourceRevision: string;
  artifactIdentityDigest: string;
  semanticManifestStorePath: string;
  semanticManifestDigest: string;
  protectedPatchEvidenceDigest: string;
};

export type TauriExternalReleaseEvidence = {
  schema: "viberoots.tauri-external-release-evidence.v2";
  qualificationAggregateStorePath: string;
  evidenceSignerIdentity: typeof REVIEWED_EVIDENCE_SIGNER_IDENTITY;
  provenance: {
    format: "viberoots.hermetic-artifact.v1";
    sourceRevision: string;
    toolSourceRevision: string;
    artifactIdentityDigest: string;
    semanticManifestStorePath: string;
    semanticManifestDigest: string;
    protectedPatchEvidenceDigest: string;
    sbomStorePath: string;
    sbomDigest: string;
  };
  sbom: {
    format: "spdx-json";
    storePath: string;
    digest: string;
  };
  signing: {
    status: "verified";
    signerIdentity: string;
    unsignedArtifactIdentityDigest: string;
    signedArtifactDigest: string;
  };
  notarization: {
    status: "verified";
    notaryIdentity: string;
    signedArtifactDigest: string;
    ticketDigest: string;
  };
};

export type TauriReleaseAdmission = {
  schema: "viberoots.tauri-release-admission.v2";
  sourceRevision: string;
  toolSourceRevision: string;
  unsignedArtifactIdentityDigest: string;
  signedArtifactDigest: string;
  semanticManifestDigest: string;
  protectedPatchEvidenceDigest: string;
  sbomDigest: string;
  signerIdentity: string;
  notaryIdentity: string;
  attestationStorePath: string;
};

export function admitTauriExternalRelease(opts: {
  qualification: TauriQualifiedArtifact;
  verifiedEvidence: VerifiedTauriReleaseEvidence;
  trustedSignerIdentities: readonly string[];
  trustedNotaryIdentities: readonly string[];
}): TauriReleaseAdmission {
  const qualification = opts.qualification;
  if (!isVerifiedTauriQualification(qualification)) {
    throw new Error("Tauri qualification did not pass protected-store verification");
  }
  if (!isVerifiedTauriReleaseEvidence(opts.verifiedEvidence)) {
    throw new Error("Tauri release evidence did not pass protected-store verification");
  }
  return validateTauriExternalRelease(opts);
}

export function validateTauriExternalRelease(opts: {
  qualification: TauriQualifiedArtifact;
  verifiedEvidence: VerifiedTauriReleaseEvidence;
  trustedSignerIdentities: readonly string[];
  trustedNotaryIdentities: readonly string[];
}): TauriReleaseAdmission {
  const qualification = opts.qualification;
  const evidence = opts.verifiedEvidence.evidence;
  exactKeys(qualification, [
    "artifactIdentityDigest",
    "evidenceSignerIdentity",
    "languageStatus",
    "matrixId",
    "qualificationAggregateStorePath",
    "semanticManifestStorePath",
    "semanticManifestDigest",
    "protectedPatchEvidenceDigest",
    "sourceRevision",
    "toolSourceRevision",
  ]);
  exactKeys(evidence, [
    "evidenceSignerIdentity",
    "notarization",
    "provenance",
    "qualificationAggregateStorePath",
    "sbom",
    "schema",
    "signing",
  ]);
  exactKeys(evidence.provenance, [
    "artifactIdentityDigest",
    "format",
    "sbomStorePath",
    "sbomDigest",
    "semanticManifestStorePath",
    "semanticManifestDigest",
    "protectedPatchEvidenceDigest",
    "sourceRevision",
    "toolSourceRevision",
  ]);
  exactKeys(evidence.sbom, ["digest", "format", "storePath"]);
  exactKeys(evidence.signing, [
    "signedArtifactDigest",
    "signerIdentity",
    "status",
    "unsignedArtifactIdentityDigest",
  ]);
  exactKeys(evidence.notarization, [
    "notaryIdentity",
    "signedArtifactDigest",
    "status",
    "ticketDigest",
  ]);
  if (
    qualification.matrixId !== "rust-tauri-darwin-pr12" ||
    qualification.languageStatus !== "graduated" ||
    qualification.evidenceSignerIdentity !== REVIEWED_EVIDENCE_SIGNER_IDENTITY ||
    !STORE_FILE.test(qualification.qualificationAggregateStorePath)
  ) {
    throw new Error("Tauri release admission requires graduated qualification evidence");
  }
  if (
    evidence.schema !== "viberoots.tauri-external-release-evidence.v2" ||
    evidence.evidenceSignerIdentity !== REVIEWED_EVIDENCE_SIGNER_IDENTITY ||
    evidence.qualificationAggregateStorePath !== qualification.qualificationAggregateStorePath
  ) {
    throw new Error("Tauri release attestation is not a verified protected-store record");
  }
  if (
    evidence.provenance.format !== "viberoots.hermetic-artifact.v1" ||
    evidence.sbom.format !== "spdx-json" ||
    evidence.signing.status !== "verified" ||
    evidence.notarization.status !== "verified"
  ) {
    throw new Error("Tauri release provenance, SBOM, signing, or notarization is not verified");
  }
  for (const digest of [
    qualification.artifactIdentityDigest,
    qualification.semanticManifestDigest,
    qualification.protectedPatchEvidenceDigest,
    evidence.provenance.artifactIdentityDigest,
    evidence.provenance.semanticManifestDigest,
    evidence.provenance.protectedPatchEvidenceDigest,
    evidence.provenance.sbomDigest,
    evidence.sbom.digest,
    evidence.signing.unsignedArtifactIdentityDigest,
    evidence.signing.signedArtifactDigest,
    evidence.notarization.signedArtifactDigest,
    evidence.notarization.ticketDigest,
  ]) {
    if (!SHA256.test(digest)) throw new Error("Tauri release evidence contains an invalid digest");
  }
  if (
    !REVISION.test(qualification.sourceRevision) ||
    !REVISION.test(qualification.toolSourceRevision) ||
    evidence.provenance.sourceRevision !== qualification.sourceRevision ||
    evidence.provenance.toolSourceRevision !== qualification.toolSourceRevision ||
    evidence.provenance.artifactIdentityDigest !== qualification.artifactIdentityDigest ||
    evidence.provenance.semanticManifestStorePath !== qualification.semanticManifestStorePath ||
    evidence.provenance.semanticManifestDigest !== qualification.semanticManifestDigest ||
    evidence.provenance.protectedPatchEvidenceDigest !==
      qualification.protectedPatchEvidenceDigest ||
    evidence.provenance.sbomStorePath !== evidence.sbom.storePath ||
    evidence.provenance.sbomDigest !== evidence.sbom.digest ||
    opts.verifiedEvidence.sbomDigest !== evidence.sbom.digest ||
    evidence.signing.unsignedArtifactIdentityDigest !== qualification.artifactIdentityDigest ||
    evidence.notarization.signedArtifactDigest !== evidence.signing.signedArtifactDigest
  ) {
    throw new Error("Tauri release evidence does not bind the qualified unsigned artifact");
  }
  if (
    !opts.trustedSignerIdentities.includes(evidence.signing.signerIdentity) ||
    !opts.trustedNotaryIdentities.includes(evidence.notarization.notaryIdentity)
  ) {
    throw new Error("Tauri release signer or notary identity is not trusted");
  }
  return {
    schema: "viberoots.tauri-release-admission.v2",
    sourceRevision: qualification.sourceRevision,
    toolSourceRevision: qualification.toolSourceRevision,
    unsignedArtifactIdentityDigest: qualification.artifactIdentityDigest,
    signedArtifactDigest: evidence.signing.signedArtifactDigest,
    semanticManifestDigest: qualification.semanticManifestDigest,
    protectedPatchEvidenceDigest: qualification.protectedPatchEvidenceDigest,
    sbomDigest: evidence.sbom.digest,
    signerIdentity: evidence.signing.signerIdentity,
    notaryIdentity: evidence.notarization.notaryIdentity,
    attestationStorePath: opts.verifiedEvidence.storePath,
  };
}

function exactKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`Tauri release evidence has invalid fields: ${actual.join(", ")}`);
  }
}
