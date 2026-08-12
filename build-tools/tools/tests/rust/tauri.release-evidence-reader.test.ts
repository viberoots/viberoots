import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import {
  admitTauriExternalRelease,
  validateTauriExternalRelease,
} from "../../ci/tauri-release-admission";
import {
  parseTauriQualification,
  parseTauriReleaseEvidence,
  readVerifiedTauriQualification,
  readVerifiedTauriReleaseEvidence,
} from "../../ci/tauri-release-evidence-reader";
import { REVIEWED_EVIDENCE_SIGNER_IDENTITY } from "../../lib/artifact-nix-policy";
import { tauriSemanticManifestBytes } from "../ci/artifact-reproducibility-aggregate-fixture";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import {
  EVIDENCE,
  externalEvidence,
  graduatedSignedAggregate,
  qualificationFixture,
  sbomBytes,
  sbomDigest,
  signedAggregate,
} from "./tauri-release-evidence-fixture";

test("Tauri qualification parses exact semantic manifest bytes from the signed output", async () => {
  const signed = await graduatedSignedAggregate();
  const semanticPath = signed.aggregate.matrixComparisons.find(
    ({ subjectId }) => subjectId === "rust-tauri-darwin-pr12",
  )!.artifactIdentity.semanticManifest;
  assert.equal(semanticPath.kind, "tauri-artifact-manifest");
  const qualification = parseTauriQualification(signed, tauriSemanticManifestBytes);
  assert.equal(qualification.semanticManifestStorePath, semanticPath.storePath);
  assert.equal(qualification.evidenceSignerIdentity, REVIEWED_EVIDENCE_SIGNER_IDENTITY);
  await assert.rejects(
    readVerifiedTauriQualification({
      signed,
      runNix: async () => ({ stdout: "" }),
    }),
    /verified protected aggregate/u,
  );
});

test("authority reader ignores attempted verifier and filesystem substitution", async () => {
  const commands: string[][] = [];
  await assert.rejects(
    readVerifiedTauriReleaseEvidence({
      file: EVIDENCE,
      evidenceStoreUri: "s3://reviewed-evidence/reproducibility",
      runNix: async (args) => {
        commands.push(args);
        return { stdout: "" };
      },
      deps: {
        verify: async () => {},
        readFile: async () => Buffer.from("{}"),
      },
    } as never),
    /ENOENT/u,
  );
  assert.ok(commands.some((args) => args[0] === "copy"));
  assert.ok(commands.some((args) => args[0] === "store" && args[1] === "verify"));
});

test("actual experimental aggregate remains a candidate after verified semantic readback", async () => {
  const manifest = JSON.parse(
    await fs.readFile(viberootsSourcePath("build-tools/tools/nix/langs.json"), "utf8"),
  );
  const signed = signedAggregate(manifest);
  const semantic = signed.aggregate.matrixComparisons.find(
    ({ subjectId }) => subjectId === "rust-tauri-darwin-pr12",
  )!.artifactIdentity.semanticManifest;
  if (semantic.kind !== "tauri-artifact-manifest") throw new Error("fixture semantic manifest");
  const qualification = parseTauriQualification(signed, tauriSemanticManifestBytes);
  assert.equal(qualification.languageStatus, "candidate");
});

test("external release evidence validation hashes actual SPDX bytes", async () => {
  const qualification = await qualificationFixture();
  const external = externalEvidence(qualification);
  const verified = parseTauriReleaseEvidence(EVIDENCE, external, sbomBytes);
  assert.equal(verified.sbomDigest, sbomDigest);
  const admitted = validateTauriExternalRelease({
    qualification,
    verifiedEvidence: verified,
    trustedSignerIdentities: ["reviewed:apple-release-signer"],
    trustedNotaryIdentities: ["reviewed:apple-notary-service"],
  });
  assert.equal(admitted.signedArtifactDigest, external.signing.signedArtifactDigest);
  assert.throws(
    () => (verified.evidence.signing.signerIdentity = "reviewed:wrong-signer"),
    /read only|Cannot assign/u,
  );
  assert.throws(
    () =>
      admitTauriExternalRelease({
        qualification,
        verifiedEvidence: verified,
        trustedSignerIdentities: ["reviewed:apple-release-signer"],
        trustedNotaryIdentities: ["reviewed:apple-notary-service"],
      }),
    /qualification did not pass/u,
  );
});
