import crypto from "node:crypto";
import fs from "node:fs/promises";
import { aggregateArtifactReproducibilityEvidence } from "../../ci/artifact-reproducibility-aggregate";
import type { TauriQualifiedArtifact } from "../../ci/tauri-release-admission";
import { parseTauriQualification } from "../../ci/tauri-release-evidence-reader";
import { REVIEWED_EVIDENCE_SIGNER_IDENTITY } from "../../lib/artifact-nix-policy";
import {
  operational,
  publication,
  records,
  registry,
  registryStorePath,
  tauriSemanticManifestBytes,
  toolClosureRoot,
  toolClosureSourceIdentity,
} from "../ci/artifact-reproducibility-aggregate-fixture";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

export const EVIDENCE = `/nix/store/${"a".repeat(32)}-tauri-release/release.json`;
export const SBOM = `/nix/store/${"b".repeat(32)}-tauri-sbom/sbom.spdx.json`;
export const sbomBytes = Buffer.from(
  JSON.stringify({
    spdxVersion: "SPDX-2.3",
    SPDXID: "SPDXRef-DOCUMENT",
    packages: [{ SPDXID: "SPDXRef-Package-tauri" }],
  }),
);
export const sbomDigest = `sha256:${crypto.createHash("sha256").update(sbomBytes).digest("hex")}`;

export function signedAggregate(
  languageManifest: ReturnType<typeof operational>["languageManifest"],
) {
  const complete = records();
  const observed = operational(complete);
  return {
    aggregate: aggregateArtifactReproducibilityEvidence({
      registry: registry(),
      registryStorePath,
      publicationSubjects: [publication],
      records: complete,
      observations: observed.observations,
      languageManifest,
      expectedSourceRevision: "f".repeat(40),
      expectedToolClosureRoot: toolClosureRoot,
      expectedToolClosureSourceIdentity: toolClosureSourceIdentity(),
      protectedRustPatchEvidence: observed.protectedRustPatchEvidence,
    }),
    storePath: `/nix/store/${"c".repeat(32)}-qualification/aggregate.json`,
    evidenceStoreUri: "s3://reviewed-evidence/reproducibility",
  };
}

export async function graduatedSignedAggregate() {
  const manifest = JSON.parse(
    await fs.readFile(viberootsSourcePath("build-tools/tools/nix/langs.json"), "utf8"),
  );
  const rust = manifest.languages.find(({ id }: { id: string }) => id === "rust");
  if (!rust) throw new Error("Rust manifest fixture is missing");
  rust.hermetic.status = "graduated";
  rust.hermetic.publicationAdmission = true;
  return signedAggregate(manifest);
}

export function externalEvidence(qualification: TauriQualifiedArtifact) {
  return {
    schema: "viberoots.tauri-external-release-evidence.v2" as const,
    qualificationAggregateStorePath: qualification.qualificationAggregateStorePath,
    evidenceSignerIdentity: REVIEWED_EVIDENCE_SIGNER_IDENTITY,
    provenance: {
      format: "viberoots.hermetic-artifact.v1" as const,
      sourceRevision: qualification.sourceRevision,
      toolSourceRevision: qualification.toolSourceRevision,
      artifactIdentityDigest: qualification.artifactIdentityDigest,
      semanticManifestStorePath: qualification.semanticManifestStorePath,
      semanticManifestDigest: qualification.semanticManifestDigest,
      protectedPatchEvidenceDigest: qualification.protectedPatchEvidenceDigest,
      sbomStorePath: SBOM,
      sbomDigest,
    },
    sbom: { format: "spdx-json" as const, storePath: SBOM, digest: sbomDigest },
    signing: {
      status: "verified" as const,
      signerIdentity: "reviewed:apple-release-signer",
      unsignedArtifactIdentityDigest: qualification.artifactIdentityDigest,
      signedArtifactDigest: `sha256:${"d".repeat(64)}`,
    },
    notarization: {
      status: "verified" as const,
      notaryIdentity: "reviewed:apple-notary-service",
      signedArtifactDigest: `sha256:${"d".repeat(64)}`,
      ticketDigest: `sha256:${"e".repeat(64)}`,
    },
  };
}

export async function qualificationFixture() {
  const signed = await graduatedSignedAggregate();
  const semantic = signed.aggregate.matrixComparisons.find(
    ({ subjectId }) => subjectId === "rust-tauri-darwin-pr12",
  )!.artifactIdentity.semanticManifest;
  if (semantic.kind !== "tauri-artifact-manifest") throw new Error("fixture semantic manifest");
  return parseTauriQualification(signed, tauriSemanticManifestBytes);
}
