import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  isProtectedReproducibilityAggregate,
  type ProtectedReproducibilityAggregate,
} from "../lib/protected-reproducibility-aggregate";
import {
  protectedStoreRoot,
  verifyProtectedStoreSignature,
  type ProtectedStoreSignatureRunner,
} from "../lib/protected-store-signature";
import { REVIEWED_EVIDENCE_SIGNER_IDENTITY } from "../lib/artifact-nix-policy";
import type {
  TauriExternalReleaseEvidence,
  TauriQualifiedArtifact,
} from "./tauri-release-admission";

const STORE_FILE = /^\/nix\/store\/[a-z0-9]{32}-[^/]+\/[^/]+\.json$/u;
const verifiedReleaseEvidence = new WeakSet<object>();
const verifiedQualifications = new WeakSet<object>();

export type VerifiedTauriReleaseEvidence = {
  storePath: string;
  evidence: TauriExternalReleaseEvidence;
  sbomDigest: string;
};

export async function readVerifiedTauriQualification(opts: {
  signed: ProtectedReproducibilityAggregate;
  runNix: ProtectedStoreSignatureRunner;
}): Promise<TauriQualifiedArtifact> {
  if (!isProtectedReproducibilityAggregate(opts.signed)) {
    throw new Error("Tauri qualification requires a verified protected aggregate");
  }
  const language = opts.signed.aggregate.languageQualification.find(
    ({ languageId }) => languageId === "rust",
  );
  const comparison = opts.signed.aggregate.matrixComparisons.find(
    ({ subjectId, system }) =>
      subjectId === "rust-tauri-darwin-pr12" && system === "aarch64-darwin",
  );
  const semantic = comparison?.artifactIdentity.semanticManifest;
  if (!language || !comparison || semantic?.kind !== "tauri-artifact-manifest") {
    throw new Error("signed aggregate lacks Rust Tauri semantic qualification");
  }
  if (!semantic.storePath.startsWith(`${comparison.artifactIdentity.outputPath}/`)) {
    throw new Error("signed Tauri semantic manifest is outside the qualified output");
  }
  await copyAndVerify(
    comparison.artifactIdentity.outputPath,
    opts.signed.evidenceStoreUri,
    opts.runNix,
  );
  await assertContainedRegularFile(comparison.artifactIdentity.outputPath, semantic.storePath);
  const bytes = await fs.readFile(semantic.storePath);
  const qualification = parseTauriQualification(opts.signed, bytes);
  verifiedQualifications.add(qualification);
  return qualification;
}

export function parseTauriQualification(
  signed: ProtectedReproducibilityAggregate,
  bytes: Buffer,
): TauriQualifiedArtifact {
  const language = signed.aggregate.languageQualification.find(
    ({ languageId }) => languageId === "rust",
  );
  const comparison = signed.aggregate.matrixComparisons.find(
    ({ subjectId, system }) =>
      subjectId === "rust-tauri-darwin-pr12" && system === "aarch64-darwin",
  );
  const semantic = comparison?.artifactIdentity.semanticManifest;
  const protectedPatchEvidence = signed.aggregate.protectedRustPatchEvidence.filter(
    ({ system }) => system === "aarch64-darwin",
  );
  if (!language || !comparison || semantic?.kind !== "tauri-artifact-manifest") {
    throw new Error("signed aggregate lacks Rust Tauri semantic qualification");
  }
  if (
    protectedPatchEvidence.length !== 2 ||
    protectedPatchEvidence.some(
      ({ sourceRevision, toolSourceRevision, cases }) =>
        sourceRevision !== signed.aggregate.sourceRevision ||
        toolSourceRevision !== signed.aggregate.toolSourceRevision ||
        !cases.some(({ caseId }) => caseId === "rust-tauri-darwin-pr12"),
    ) ||
    protectedPatchEvidence
      .map(({ builderAuthority }) => builderAuthority.identity)
      .sort()
      .join("\0") !==
      comparison.builderAuthorities
        .map(({ identity }) => identity)
        .sort()
        .join("\0")
  ) {
    throw new Error("signed aggregate lacks matching protected Tauri patch evidence");
  }
  const parsed = JSON.parse(bytes.toString()) as {
    schema?: unknown;
    signature?: { releaseSigned?: unknown; releaseAdmitted?: unknown };
  };
  if (
    parsed.schema !== "viberoots.tauri-artifact.v1" ||
    parsed.signature?.releaseSigned !== false ||
    parsed.signature?.releaseAdmitted !== false ||
    digest(bytes) !== semantic.digest
  ) {
    throw new Error("signed Tauri semantic manifest bytes do not match qualification");
  }
  return deepFreeze({
    matrixId: "rust-tauri-darwin-pr12",
    languageStatus: language.status,
    qualificationAggregateStorePath: signed.storePath,
    evidenceSignerIdentity: REVIEWED_EVIDENCE_SIGNER_IDENTITY,
    sourceRevision: signed.aggregate.sourceRevision,
    toolSourceRevision: signed.aggregate.toolSourceRevision,
    artifactIdentityDigest: comparison.artifactIdentityDigest,
    semanticManifestStorePath: semantic.storePath,
    semanticManifestDigest: semantic.digest,
    protectedPatchEvidenceDigest: digest(Buffer.from(JSON.stringify(protectedPatchEvidence))),
  } satisfies TauriQualifiedArtifact);
}

export async function readVerifiedTauriReleaseEvidence(opts: {
  file: string;
  evidenceStoreUri: string;
  runNix: ProtectedStoreSignatureRunner;
}): Promise<VerifiedTauriReleaseEvidence> {
  if (!STORE_FILE.test(opts.file)) {
    throw new Error("Tauri release evidence must be an immutable store JSON file");
  }
  await copyAndVerify(opts.file, opts.evidenceStoreUri, opts.runNix);
  const text = await fs.readFile(opts.file, "utf8");
  const evidence = JSON.parse(text) as TauriExternalReleaseEvidence;
  if (!STORE_FILE.test(evidence.sbom.storePath)) {
    throw new Error("Tauri release evidence requires an immutable SPDX document");
  }
  await copyAndVerify(evidence.sbom.storePath, opts.evidenceStoreUri, opts.runNix);
  const sbomBytes = await fs.readFile(evidence.sbom.storePath);
  const verified = parseTauriReleaseEvidence(opts.file, evidence, sbomBytes);
  verifiedReleaseEvidence.add(verified);
  return verified;
}

export function parseTauriReleaseEvidence(
  file: string,
  evidence: TauriExternalReleaseEvidence,
  sbomBytes: Buffer,
): VerifiedTauriReleaseEvidence {
  if (!STORE_FILE.test(file) || !STORE_FILE.test(evidence.sbom.storePath)) {
    throw new Error("Tauri release evidence requires immutable store JSON and SPDX files");
  }
  const sbom = JSON.parse(sbomBytes.toString()) as {
    spdxVersion?: unknown;
    SPDXID?: unknown;
    packages?: unknown;
  };
  const sbomDigest = digest(sbomBytes);
  if (
    !String(sbom.spdxVersion || "").startsWith("SPDX-2.") ||
    sbom.SPDXID !== "SPDXRef-DOCUMENT" ||
    !Array.isArray(sbom.packages) ||
    sbomDigest !== evidence.sbom.digest
  ) {
    throw new Error("Tauri release SPDX document is invalid or has mismatched bytes");
  }
  return deepFreeze({ storePath: file, evidence, sbomDigest });
}

export function isVerifiedTauriReleaseEvidence(value: VerifiedTauriReleaseEvidence): boolean {
  return verifiedReleaseEvidence.has(value);
}

export function isVerifiedTauriQualification(value: TauriQualifiedArtifact): boolean {
  return verifiedQualifications.has(value);
}

async function copyAndVerify(
  file: string,
  evidenceStoreUri: string,
  runNix: ProtectedStoreSignatureRunner,
): Promise<void> {
  await runNix(["copy", "--from", evidenceStoreUri, protectedStoreRoot(file)]);
  await verifyProtectedStoreSignature(file, runNix);
}

function digest(bytes: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export async function assertContainedRegularFile(root: string, file: string): Promise<void> {
  const [resolvedRoot, resolvedFile, stat] = await Promise.all([
    fs.realpath(root),
    fs.realpath(file),
    fs.stat(file),
  ]);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (
    !stat.isFile() ||
    relative === "" ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("signed Tauri semantic manifest escapes the qualified output");
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
