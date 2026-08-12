import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readArtifactSemanticManifest } from "../../ci/artifact-reproducibility-semantic-manifest";

test("every representative Rust matrix family hashes its materialization manifest", async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "viberoots-rust-semantic-"));
  try {
    const storePath = path.join(output, "share/viberoots-rust/materialization-manifest.json");
    const bytes = Buffer.from(
      JSON.stringify({
        schemaVersion: "viberoots.nix-store-materialization.v1",
        storePaths: [{ path: output }],
      }),
    );
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, bytes);
    const matrixIds = [
      "rust-pr5",
      "rust-test-pr12",
      "rust-lib-pr12",
      "rust-proc-macro-pr12",
      "rust-python-extension-pr12",
      "rust-node-addon-pr12",
      "rust-c-ffi-pr12",
      "rust-cxx-bridge-pr12",
      "rust-wasm-pr12",
      "rust-wasm-static-pr12",
      "rust-wasi-static-pr12",
      "rust-wasm-browser-pr12",
      "rust-wasm-component-pr12",
      "rust-wasi-pr12",
      "rust-cross-root-pr12",
    ];
    for (const matrixId of matrixIds) {
      assert.deepEqual(
        await readArtifactSemanticManifest(output, {
          kind: "matrix",
          matrixId,
          matrixDigest: `sha256:${"a".repeat(64)}`,
          artifactFamily: "rust",
          recipeDigest: `sha256:${"b".repeat(64)}`,
          bindingDigest: `sha256:${"c".repeat(64)}`,
          target: "//projects/example:example",
        }),
        {
          kind: "rust-materialization-manifest",
          storePath,
          digest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
        },
        matrixId,
      );
    }
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});

test("Tauri reproducibility evidence hashes the exact installed semantic manifest bytes", async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "viberoots-tauri-semantic-"));
  try {
    const storePath = path.join(output, "share/viberoots-tauri/artifact-manifest.json");
    const bytes = Buffer.from(
      JSON.stringify({
        schema: "viberoots.tauri-artifact.v1",
        signature: { releaseSigned: false, releaseAdmitted: false },
      }),
    );
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, bytes);
    const semantic = await readArtifactSemanticManifest(output, {
      kind: "matrix",
      matrixId: "rust-tauri-darwin-pr12",
      matrixDigest: `sha256:${"a".repeat(64)}`,
      artifactFamily: "rust",
      recipeDigest: `sha256:${"b".repeat(64)}`,
      bindingDigest: `sha256:${"c".repeat(64)}`,
      target: "//projects/apps/repro-rust-tauri:repro-rust-tauri",
    });
    assert.deepEqual(semantic, {
      kind: "tauri-artifact-manifest",
      storePath,
      digest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    });
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});

test("all Rust semantic manifest kinds cross the supplied remote store-read boundary", async () => {
  const output = `/nix/store/${"d".repeat(32)}-remote-only-rust-output`;
  const cases = [
    {
      matrixId: "rust-lib-pr12",
      relative: "share/viberoots-rust/materialization-manifest.json",
      manifest: {
        schemaVersion: "viberoots.nix-store-materialization.v1",
        storePaths: [{ path: output }],
      },
      kind: "rust-materialization-manifest",
    },
    {
      matrixId: "rust-tauri-darwin-pr12",
      relative: "share/viberoots-tauri/artifact-manifest.json",
      manifest: {
        schema: "viberoots.tauri-artifact.v1",
        signature: { releaseSigned: false, releaseAdmitted: false },
      },
      kind: "tauri-artifact-manifest",
    },
  ] as const;
  for (const entry of cases) {
    const expectedPath = path.join(output, entry.relative);
    const bytes = Buffer.from(JSON.stringify(entry.manifest));
    const reads: string[] = [];
    const semantic = await readArtifactSemanticManifest(
      output,
      {
        kind: "matrix",
        matrixId: entry.matrixId,
        matrixDigest: `sha256:${"a".repeat(64)}`,
        artifactFamily: "rust",
        recipeDigest: `sha256:${"b".repeat(64)}`,
        bindingDigest: `sha256:${"c".repeat(64)}`,
        target: "//projects/example:example",
      },
      async (storePath) => {
        reads.push(storePath);
        return bytes;
      },
    );
    assert.deepEqual(reads, [expectedPath]);
    assert.equal(semantic.kind, entry.kind);
    assert.equal(semantic.storePath, expectedPath);
    assert.equal(
      semantic.digest,
      `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    );
  }
});
