#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import path from "node:path";
import { readArtifactSemanticManifest } from "../../ci/artifact-reproducibility-semantic-manifest";

test("all Rust semantic manifest kinds cross the supplied remote store-read boundary", async () => {
  const output = `/nix/store/${"d".repeat(32)}-remote-only-rust-output`;
  const cases = [
    rustCase(
      "rust-lib-pr12",
      "share/viberoots-rust/materialization-manifest.json",
      "rust-materialization-manifest",
    ),
    rustCase(
      "rust-pyodide-extension-pr14",
      "share/viberoots-python-wasm/materialization-manifest.json",
      "python-wasm-materialization-manifest",
    ),
    rustCase(
      "rust-tauri-darwin-pr12",
      "share/viberoots-tauri/artifact-manifest.json",
      "tauri-artifact-manifest",
    ),
  ] as const;
  for (const entry of cases) {
    const expectedPath = path.join(output, entry.relative);
    const bytes = Buffer.from(JSON.stringify(entry.manifest));
    const reads: string[] = [];
    const semantic = await readArtifactSemanticManifest(
      output,
      rustMatrixIdentity(entry.matrixId),
      async (storePath) => {
        reads.push(storePath);
        if (storePath.endsWith("provenance.json")) return Buffer.from(JSON.stringify(provenance()));
        if (storePath.endsWith("sbom.spdx.json")) {
          return Buffer.from(JSON.stringify({ spdxVersion: "SPDX-2.3", packages: [] }));
        }
        return bytes;
      },
    );
    assert.deepEqual(reads, expectedReads(entry.matrixId, expectedPath, output));
    assert.equal(semantic.kind, entry.kind);
    assert.equal(semantic.storePath, expectedPath);
    assert.equal(
      semantic.digest,
      `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    );
  }
});

function rustMatrixIdentity(matrixId: string) {
  return {
    kind: "matrix" as const,
    matrixId,
    matrixDigest: `sha256:${"a".repeat(64)}`,
    artifactFamily: "rust",
    recipeDigest: `sha256:${"b".repeat(64)}`,
    bindingDigest: `sha256:${"c".repeat(64)}`,
    target: "//projects/example:example",
  };
}

function rustCase(matrixId: string, relative: string, kind: string) {
  return {
    matrixId,
    relative,
    kind,
    manifest:
      matrixId === "rust-pyodide-extension-pr14"
        ? {
            schemaVersion: "viberoots.nix-store-materialization.v1",
            evidence: pyodideEvidence(),
            storePaths: [{ path: `/nix/store/${"d".repeat(32)}-remote-only-rust-output` }],
          }
        : matrixId === "rust-tauri-darwin-pr12"
          ? {
              schema: "viberoots.tauri-artifact.v1",
              signature: { releaseSigned: false, releaseAdmitted: false },
            }
          : {
              schemaVersion: "viberoots.nix-store-materialization.v1",
              storePaths: [{ path: `/nix/store/${"d".repeat(32)}-remote-only-rust-output` }],
            },
  };
}

function pyodideEvidence() {
  return {
    provenance: {
      path: "share/viberoots-python-wasm/provenance.json",
      schema: "viberoots.python-wasm-provenance.v1",
    },
    sbom: { path: "share/viberoots-python-wasm/sbom.spdx.json", format: "spdx-json" },
    pyemscriptenAbi: { path: "share/viberoots-python-wasm/pyemscripten-abi.json" },
  };
}

function provenance() {
  return {
    schema: "viberoots.python-wasm-provenance.v1",
    authority: {
      sbom: "share/viberoots-python-wasm/sbom.spdx.json",
      pyemscriptenAbi: "share/viberoots-python-wasm/pyemscripten-abi.json",
    },
  };
}

function expectedReads(matrixId: string, expectedPath: string, output: string): string[] {
  return matrixId === "rust-pyodide-extension-pr14"
    ? [
        expectedPath,
        path.join(output, "share/viberoots-python-wasm/provenance.json"),
        path.join(output, "share/viberoots-python-wasm/sbom.spdx.json"),
      ]
    : [expectedPath];
}
