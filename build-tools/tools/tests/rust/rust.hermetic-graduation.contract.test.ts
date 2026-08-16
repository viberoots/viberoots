import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  assertLanguageQualificationProofs,
  proveLanguageQualification,
} from "../../ci/artifact-reproducibility-language-qualification";
import {
  reproducibilityMatrixIdsForArtifactFamily,
  reproducibilityMatrixSystemPairs,
} from "../../lib/artifact-reproducibility-matrix";
import { languageEnablementGaps } from "../../lib/lang-contracts";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const read = (relative: string) => fs.readFileSync(viberootsSourcePath(relative), "utf8");

function rustManifest() {
  const manifest = JSON.parse(read("build-tools/tools/nix/langs.json"));
  return manifest.languages.find((entry: { id?: string }) => entry.id === "rust");
}

function successfulComparisons() {
  return reproducibilityMatrixSystemPairs().map(({ matrixId, system }) => ({
    subjectId: matrixId,
    system,
  }));
}

test("Rust repository policy is wired without claiming external graduation", () => {
  const rust = rustManifest();
  assert.equal(rust.hermetic.status, "experimental");
  assert.equal(rust.hermetic.sandboxNetwork, true);
  assert.equal(rust.hermetic.remoteExecution, true);
  assert.equal(rust.hermetic.publicationAdmission, false);
  assert.match(rust.supportNotes.remoteExecution, /rust-pyodide-extension-pr14/);
  assert.match(rust.supportNotes.publicationAdmission, /external release admission remains false/);
  assert.deepEqual(languageEnablementGaps(rust.hermetic), []);
  assert.deepEqual(
    rust.hermetic.reproducibilityMatrixIds,
    reproducibilityMatrixIdsForArtifactFamily("rust"),
  );
  const action = read("build-tools/rust/private/nix_build.bzl");
  assert.match(action, /run_nix_action\(/);
  assert.match(action, /declared_inputs = declared_inputs/);
  assert.match(action, /mode = "remote-ready" if remote_requested else "local-only"/);
});

test("actual experimental manifest emits candidate qualification without publication admission", () => {
  const manifest = JSON.parse(read("build-tools/tools/nix/langs.json"));
  const complete = successfulComparisons();
  const proofs = proveLanguageQualification(manifest, complete);
  const rust = proofs.find(({ languageId }) => languageId === "rust")!;
  assert.deepEqual([rust.status, rust.publicationAdmitted], ["candidate", false]);
  assert.doesNotThrow(() => assertLanguageQualificationProofs(proofs, complete));
  for (const missing of [
    { subjectId: "rust-pr5", system: "aarch64-linux" },
    { subjectId: "rust-tauri-darwin-pr12", system: "aarch64-darwin" },
  ]) {
    assert.throws(
      () =>
        proveLanguageQualification(
          manifest,
          complete.filter(
            (entry) => entry.subjectId !== missing.subjectId || entry.system !== missing.system,
          ),
        ),
      /language lacks a successful matrix comparison/,
    );
  }
  assert.throws(
    () =>
      assertLanguageQualificationProofs(
        proofs.map((proof) =>
          proof.languageId === "rust"
            ? { ...proof, status: "graduated", publicationAdmitted: false }
            : proof,
        ),
        complete,
      ),
    /language qualification state is invalid/,
  );
});

test("graduation becomes release-admitted only after publication admission is true", () => {
  const rust = structuredClone(rustManifest());
  rust.hermetic.status = "graduated";
  rust.hermetic.publicationAdmission = true;
  const proof = proveLanguageQualification(
    { enabled: ["rust"], languages: [rust] },
    successfulComparisons(),
  )[0]!;
  assert.deepEqual([proof.status, proof.publicationAdmitted], ["graduated", true]);
});

test("deterministic Tauri construction rejects credentials and remains unsigned", () => {
  const template = read("build-tools/tools/nix/templates/rust-tauri.nix");
  for (const credential of [
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_PASSWORD",
    "APPLE_ID",
    "APPLE_TEAM_ID",
  ]) {
    assert.match(template, new RegExp(credential));
  }
  assert.match(template, /ambient Apple signing credentials are forbidden/);
  assert.match(template, /releaseSigned:false/);
  assert.match(template, /releaseAdmitted:false/);
  assert.doesNotMatch(template, /releaseSigned:true|releaseAdmitted:true/);
});
