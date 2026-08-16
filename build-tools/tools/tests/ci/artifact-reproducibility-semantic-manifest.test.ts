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

test("Rust Pyodide reproducibility evidence hashes the Python WASM materialization manifest", async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "viberoots-pyodide-semantic-"));
  try {
    const storePath = path.join(
      output,
      "share/viberoots-python-wasm/materialization-manifest.json",
    );
    const bytes = Buffer.from(
      JSON.stringify({
        schemaVersion: "viberoots.nix-store-materialization.v1",
        evidence: {
          provenance: {
            path: "share/viberoots-python-wasm/provenance.json",
            schema: "viberoots.python-wasm-provenance.v1",
          },
          sbom: { path: "share/viberoots-python-wasm/sbom.spdx.json", format: "spdx-json" },
          pyemscriptenAbi: { path: "share/viberoots-python-wasm/pyemscripten-abi.json" },
        },
        storePaths: [{ path: output }],
      }),
    );
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, bytes);
    await fs.writeFile(
      path.join(output, "share/viberoots-python-wasm/provenance.json"),
      JSON.stringify({
        schema: "viberoots.python-wasm-provenance.v1",
        authority: {
          sbom: "share/viberoots-python-wasm/sbom.spdx.json",
          pyemscriptenAbi: "share/viberoots-python-wasm/pyemscripten-abi.json",
        },
      }),
    );
    await fs.writeFile(
      path.join(output, "share/viberoots-python-wasm/sbom.spdx.json"),
      JSON.stringify({ spdxVersion: "SPDX-2.3", packages: [] }),
    );
    assert.deepEqual(
      await readArtifactSemanticManifest(output, {
        kind: "matrix",
        matrixId: "rust-pyodide-extension-pr14",
        matrixDigest: `sha256:${"a".repeat(64)}`,
        artifactFamily: "rust",
        recipeDigest: `sha256:${"b".repeat(64)}`,
        bindingDigest: `sha256:${"c".repeat(64)}`,
        target: "//projects/apps/repro-rust-pyodide:repro-rust-pyodide",
      }),
      {
        kind: "python-wasm-materialization-manifest",
        storePath,
        digest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
      },
    );
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});

test("Rust Pyodide semantic evidence rejects missing or tampered SBOM and provenance authority", async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "viberoots-pyodide-evidence-"));
  try {
    const share = path.join(output, "share/viberoots-python-wasm");
    await fs.mkdir(share, { recursive: true });
    await fs.writeFile(
      path.join(share, "materialization-manifest.json"),
      JSON.stringify({
        schemaVersion: "viberoots.nix-store-materialization.v1",
        evidence: {
          provenance: {
            path: "share/viberoots-python-wasm/provenance.json",
            schema: "viberoots.python-wasm-provenance.v1",
          },
          sbom: { path: "share/viberoots-python-wasm/sbom.spdx.json", format: "spdx-json" },
          pyemscriptenAbi: { path: "share/viberoots-python-wasm/pyemscripten-abi.json" },
        },
        storePaths: [{ path: output }],
      }),
    );
    await fs.writeFile(
      path.join(share, "provenance.json"),
      JSON.stringify({
        schema: "viberoots.python-wasm-provenance.v1",
        authority: {
          sbom: "share/viberoots-python-wasm/tampered.spdx.json",
          pyemscriptenAbi: "share/viberoots-python-wasm/pyemscripten-abi.json",
        },
      }),
    );
    await fs.writeFile(
      path.join(share, "sbom.spdx.json"),
      JSON.stringify({ spdxVersion: "SPDX-2.3", packages: [] }),
    );
    await assert.rejects(
      readArtifactSemanticManifest(output, {
        kind: "matrix",
        matrixId: "rust-pyodide-extension-pr14",
        matrixDigest: `sha256:${"a".repeat(64)}`,
        artifactFamily: "rust",
        recipeDigest: `sha256:${"b".repeat(64)}`,
        bindingDigest: `sha256:${"c".repeat(64)}`,
        target: "//projects/apps/repro-rust-pyodide:repro-rust-pyodide",
      }),
      /invalid provenance or SBOM authority/u,
    );
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
