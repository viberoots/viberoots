import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateTauriExternalRelease } from "../../ci/tauri-release-admission";
import {
  assertContainedRegularFile,
  parseTauriReleaseEvidence,
} from "../../ci/tauri-release-evidence-reader";
import {
  EVIDENCE,
  externalEvidence,
  qualificationFixture,
  sbomBytes,
} from "./tauri-release-evidence-fixture";

test("semantic manifest containment rejects a symlink escaping the qualified output", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "viberoots-tauri-containment-"));
  try {
    const output = path.join(tmp, "output");
    const outside = path.join(tmp, "outside.json");
    const link = path.join(output, "manifest.json");
    await fs.mkdir(output);
    await fs.writeFile(outside, "{}");
    await fs.symlink(outside, link);
    await assert.rejects(assertContainedRegularFile(output, link), /escapes/u);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("release evidence rejects SPDX byte tampering and store-path substitution", async () => {
  const qualification = await qualificationFixture();
  const cases = [
    {
      expected: /mismatched bytes/u,
      evidence: externalEvidence(qualification),
      sbom: Buffer.from('{"spdxVersion":"SPDX-2.3","SPDXID":"SPDXRef-DOCUMENT","packages":[]}'),
    },
    {
      expected: /immutable store JSON and SPDX/u,
      evidence: externalEvidence(qualification),
      sbom: sbomBytes,
    },
  ];
  cases[1].evidence.sbom.storePath = "/tmp/substituted.spdx.json";
  for (const fixtureCase of cases) {
    assert.throws(
      () => parseTauriReleaseEvidence(EVIDENCE, fixtureCase.evidence, fixtureCase.sbom),
      fixtureCase.expected,
    );
  }
});

test("release admission rejects aggregate, signer, notary, and provenance substitutions", async () => {
  const qualification = await qualificationFixture();
  const cases = [
    (value: ReturnType<typeof externalEvidence>) =>
      (value.qualificationAggregateStorePath = `/nix/store/${"f".repeat(32)}-other/a.json`),
    (value: ReturnType<typeof externalEvidence>) =>
      (value.signing.signerIdentity = "reviewed:wrong-signer"),
    (value: ReturnType<typeof externalEvidence>) =>
      (value.notarization.notaryIdentity = "reviewed:wrong-notary"),
    (value: ReturnType<typeof externalEvidence>) =>
      (value.provenance.semanticManifestStorePath = `${qualification.semanticManifestStorePath}.x`),
    (value: ReturnType<typeof externalEvidence>) =>
      (value.provenance.protectedPatchEvidenceDigest = `sha256:${"0".repeat(64)}`),
    (value: ReturnType<typeof externalEvidence>) =>
      (value.provenance.toolSourceRevision = "0".repeat(40)),
  ];
  for (const mutate of cases) {
    const external = externalEvidence(qualification);
    mutate(external);
    const verified = parseTauriReleaseEvidence(EVIDENCE, external, sbomBytes);
    assert.throws(() =>
      validateTauriExternalRelease({
        qualification,
        verifiedEvidence: verified,
        trustedSignerIdentities: ["reviewed:apple-release-signer"],
        trustedNotaryIdentities: ["reviewed:apple-notary-service"],
      }),
    );
  }
});
