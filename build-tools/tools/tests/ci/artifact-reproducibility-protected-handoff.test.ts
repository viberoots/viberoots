import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ArtifactReproducibilityRunRecord } from "../../ci/artifact-reproducibility-aggregate";
import {
  assertCanonicalStoreRootLayout,
  assertHydratedArtifactOutputIdentities,
  protectedArtifactOutputIdentities,
  signedEvidenceReadbackArgs,
  unsignedEvidenceIngressArgs,
} from "../../ci/artifact-reproducibility-protected-handoff";
import { artifactReproducibilityEvidenceFixture } from "./artifact-reproducibility.fixture";

const outputPath = `/nix/store/${"b".repeat(32)}-artifact`;
const derivationPath = `/nix/store/${"a".repeat(32)}-artifact.drv`;
const narHash = `sha256:${"6".repeat(64)}`;
const closureIdentityDigest = `sha256:${crypto
  .createHash("sha256")
  .update(JSON.stringify([{ narHash, path: outputPath }]))
  .digest("hex")}`;

function record(overrides: Record<string, unknown> = {}): ArtifactReproducibilityRunRecord {
  return {
    evidence: artifactReproducibilityEvidenceFixture({
      outputPath,
      derivationPath,
      narHash,
      closureIdentityDigest,
      ...overrides,
    }),
  } as ArtifactReproducibilityRunRecord;
}

test("unsigned ingress is bounded to exact prevalidated store roots", () => {
  assert.deepEqual(unsignedEvidenceIngressArgs("s3://evidence/root", [outputPath]), [
    "copy",
    "--no-check-sigs",
    "--from",
    "s3://evidence/root",
    outputPath,
  ]);
  assert.throws(
    () => unsignedEvidenceIngressArgs("s3://evidence/root", ["/tmp/output"]),
    /exact expected store roots/,
  );
});

test("signed readback copies from evidence storage into a distinct fresh file cache", () => {
  assert.deepEqual(
    signedEvidenceReadbackArgs("s3://evidence/root", "file:///tmp/fresh-cache", [outputPath]),
    ["copy", "--from", "s3://evidence/root", "--to", "file:///tmp/fresh-cache", outputPath],
  );
  assert.throws(
    () => signedEvidenceReadbackArgs("s3://evidence/root", "local", [outputPath]),
    /fresh file-cache destination/,
  );
});

test("unsigned evidence roots must have one canonical regular file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "protected-handoff-layout-"));
  const record = path.join(root, "run-record.json");
  try {
    await fs.writeFile(record, "{}\n");
    await assert.doesNotReject(assertCanonicalStoreRootLayout(record, "run-record.json"));
    await fs.writeFile(path.join(root, "extra"), "unvalidated\n");
    await assert.rejects(
      assertCanonicalStoreRootLayout(record, "run-record.json"),
      /must contain only run-record.json/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("accepted outputs deduplicate exact identities and reject conflicts", () => {
  assert.deepEqual(protectedArtifactOutputIdentities([record(), record()]), [
    { closureIdentityDigest, derivationPath, narHash, outputPath },
  ]);
  assert.throws(
    () =>
      protectedArtifactOutputIdentities([
        record(),
        record({ narHash: `sha256:${"7".repeat(64)}` }),
      ]),
    /conflicting immutable identities/,
  );
});

test("untrusted output hydration must match derivation, NAR, and recursive closure identity", async () => {
  const expected = protectedArtifactOutputIdentities([record()]);
  const runNix = async (args: string[]) => {
    if (args.includes("--derivation")) return { stdout: derivationPath };
    return { stdout: JSON.stringify([{ path: outputPath, narHash }]) };
  };
  await assert.doesNotReject(assertHydratedArtifactOutputIdentities(expected, runNix));
  await assert.rejects(
    assertHydratedArtifactOutputIdentities(expected, async (args) =>
      args.includes("--derivation")
        ? { stdout: derivationPath }
        : { stdout: JSON.stringify([{ path: outputPath, narHash: `sha256:${"8".repeat(64)}` }]) },
    ),
    /hydrated artifact output identity mismatch/,
  );
});
