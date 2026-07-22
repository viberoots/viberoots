import fs from "node:fs/promises";
import {
  parseArtifactReproducibilityAggregate,
  type ArtifactReproducibilityAggregate,
} from "../ci/artifact-reproducibility-aggregate";
import {
  canonicalJson,
  parseReviewedRemoteBuilders,
} from "../remote-exec/remote-builder-authority";
import {
  protectedStoreRoot,
  verifyProtectedStoreSignature,
  type ProtectedStoreSignatureRunner,
} from "./protected-store-signature";

export type ProtectedReproducibilityAggregate = {
  storePath: string;
  aggregate: ArtifactReproducibilityAggregate;
  evidenceStoreUri: string;
};

export function assertReviewedEvidenceStoreUri(uri: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error("signed aggregate evidence store URI is invalid");
  }
  if (
    parsed.protocol !== "s3:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("signed aggregate evidence store must be credential-free signed S3");
  }
  return uri;
}

export function assertEvidenceStoreLocatorMatchesRegistry(
  locator: string,
  registryStoreUri: string,
): string {
  const candidate = assertReviewedEvidenceStoreUri(locator);
  const signed = assertReviewedEvidenceStoreUri(registryStoreUri);
  if (candidate !== signed) {
    throw new Error("evidence-store locator does not match the signed registry authority");
  }
  return signed;
}

export async function readProtectedReproducibilityAggregate(
  file: string,
  evidenceStoreLocator: string,
  runNix: ProtectedStoreSignatureRunner,
): Promise<ProtectedReproducibilityAggregate> {
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/aggregate\.json$/u.test(file)) {
    throw new Error("protected use requires an immutable signed aggregate store path");
  }
  const candidateStoreUri = assertReviewedEvidenceStoreUri(evidenceStoreLocator);
  await runNix(["copy", "--from", candidateStoreUri, protectedStoreRoot(file)]);
  await verifyProtectedStoreSignature(file, runNix);
  const text = await fs.readFile(file, "utf8");
  const untrusted = JSON.parse(text) as Partial<ArtifactReproducibilityAggregate>;
  const registryStorePath = String(untrusted.registryStorePath || "");
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/registry\.json$/u.test(registryStorePath)) {
    throw new Error("signed aggregate lacks its immutable reviewed-builder registry");
  }
  await runNix(["copy", "--from", candidateStoreUri, protectedStoreRoot(registryStorePath)]);
  await verifyProtectedStoreSignature(registryStorePath, runNix);
  const registryText = await fs.readFile(registryStorePath, "utf8");
  const registry = parseReviewedRemoteBuilders(JSON.parse(registryText));
  if (registryText !== canonicalJson(registry)) {
    throw new Error("signed aggregate reviewed-builder registry is not canonical");
  }
  const evidenceStoreUri = assertEvidenceStoreLocatorMatchesRegistry(
    candidateStoreUri,
    registry.evidenceStore.storeUri,
  );
  return {
    storePath: file,
    aggregate: parseArtifactReproducibilityAggregate(text, {
      registry,
      registryStorePath,
    }),
    evidenceStoreUri,
  };
}
