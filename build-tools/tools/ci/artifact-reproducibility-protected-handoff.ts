import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ArtifactReproducibilityRunRecord } from "./artifact-reproducibility-aggregate";
import { readArtifactPathIdentity } from "./artifact-reproducibility-producer";

export type ProtectedOutputIdentity = Pick<
  ArtifactReproducibilityRunRecord["evidence"],
  "closureIdentityDigest" | "derivationPath" | "narHash" | "outputPath"
>;

export function unsignedEvidenceIngressArgs(storeUri: string, roots: string[]): string[] {
  assertExactStoreRoots(roots, "unsigned evidence ingress");
  return ["copy", "--no-check-sigs", "--from", storeUri, ...roots];
}

export function signedEvidenceReadbackArgs(
  storeUri: string,
  destinationUri: string,
  roots: string[],
): string[] {
  assertExactStoreRoots(roots, "signed evidence readback");
  if (!destinationUri.startsWith("file://")) {
    throw new Error("signed evidence readback requires a fresh file-cache destination");
  }
  return ["copy", "--from", storeUri, "--to", destinationUri, ...roots];
}

export async function proveSignedEvidenceStoreReadback(opts: {
  evidenceStore: string;
  roots: string[];
  tempParent: string;
  runNix: (args: string[]) => Promise<{ stdout: string }>;
}): Promise<void> {
  const readbackRoot = await fs.mkdtemp(path.join(opts.tempParent, ".vbr-signed-readback-"));
  try {
    await opts.runNix(
      signedEvidenceReadbackArgs(opts.evidenceStore, pathToFileURL(readbackRoot).href, opts.roots),
    );
  } finally {
    await fs.rm(readbackRoot, { recursive: true, force: true });
  }
}

export async function assertCanonicalStoreRootLayout(
  file: string,
  expectedName: "run-observation.json" | "run-record.json",
): Promise<void> {
  if (path.basename(file) !== expectedName) {
    throw new Error(`protected evidence root requires ${expectedName}`);
  }
  const entries = await fs.readdir(path.dirname(file), { withFileTypes: true });
  if (entries.length !== 1 || entries[0]!.name !== expectedName || !entries[0]!.isFile()) {
    throw new Error(`protected evidence root must contain only ${expectedName}`);
  }
}

export function protectedArtifactOutputIdentities(
  records: readonly ArtifactReproducibilityRunRecord[],
): ProtectedOutputIdentity[] {
  const byPath = new Map<string, ProtectedOutputIdentity>();
  for (const { evidence } of records) {
    const identity = {
      closureIdentityDigest: evidence.closureIdentityDigest,
      derivationPath: evidence.derivationPath,
      narHash: evidence.narHash,
      outputPath: evidence.outputPath,
    };
    const prior = byPath.get(identity.outputPath);
    if (prior && JSON.stringify(prior) !== JSON.stringify(identity)) {
      throw new Error("accepted output path has conflicting immutable identities");
    }
    byPath.set(identity.outputPath, identity);
  }
  return [...byPath.values()].sort((left, right) =>
    left.outputPath.localeCompare(right.outputPath),
  );
}

export async function assertHydratedArtifactOutputIdentities(
  expected: readonly ProtectedOutputIdentity[],
  runNix: (args: string[]) => Promise<{ stdout: string }>,
): Promise<void> {
  for (const identity of expected) {
    const actual = await readArtifactPathIdentity(identity.outputPath, runNix);
    if (
      actual.derivationPath !== identity.derivationPath ||
      actual.narHash !== identity.narHash ||
      actual.closureIdentityDigest !== identity.closureIdentityDigest
    ) {
      throw new Error(`hydrated artifact output identity mismatch: ${identity.outputPath}`);
    }
  }
}

function assertExactStoreRoots(roots: string[], name: string): void {
  if (!roots.length || roots.some((root) => !/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(root))) {
    throw new Error(`${name} requires exact expected store roots`);
  }
}
