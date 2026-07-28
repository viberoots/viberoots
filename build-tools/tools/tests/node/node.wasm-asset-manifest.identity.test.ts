#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  appendWasmAssetManifestEntry,
  portableWasmAssetSourceIdentity,
} from "../../node/wasm-asset-manifest";
import { runInTemp } from "../lib/test-helpers";

test("WASM asset manifests use portable source identity without changing bytes", async () => {
  await runInTemp("node-wasm-portable-manifest", async (tmp) => {
    const identities: string[] = [];
    const bytes = Buffer.from("stable-wasm-bytes");
    const sha256 = `sha256-${crypto.createHash("sha256").update(bytes).digest("hex")}`;
    for (const workspace of ["workspace-a", "workspace-b"]) {
      const root = path.join(tmp, workspace, "buck-out", "gen");
      const blob = path.join(root, "inline.js");
      const manifest = path.join(root, "asset-manifest.json");
      await fsp.mkdir(root, { recursive: true });
      await fsp.writeFile(blob, bytes);
      await fsp.writeFile(
        manifest,
        '{"schemaVersion":"viberoots.node-wasm-assets.v1","assets":[]}\n',
      );
      appendWasmAssetManifestEntry(":inline", blob, "lib/inline.js", blob, manifest);
      const entry = JSON.parse(await fsp.readFile(manifest, "utf8")).assets[0];
      identities.push(entry.resolvedSource);
      assert.equal(entry.sha256, sha256);
      assert.deepEqual(await fsp.readFile(blob), bytes);
      assert.doesNotMatch(entry.resolvedSource, /workspace-|buck-out|viberoots-test-tmp/);
    }
    assert.deepEqual(identities, [`buck::inline#${sha256}`, `buck::inline#${sha256}`]);
    assert.equal(
      portableWasmAssetSourceIdentity(
        "//pkg:wasm",
        "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-wasm/lib/top.wasm",
        sha256,
      ),
      "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-wasm/lib/top.wasm",
    );
    assert.equal(
      portableWasmAssetSourceIdentity(
        "//pkg:wasm",
        "/tmp/workspace/nix/store/fake/buck-out/top.wasm",
        sha256,
      ),
      `buck://pkg:wasm#${sha256}`,
    );

    const inlineRoot = path.join(tmp, "inline-lineage");
    const inline = path.join(inlineRoot, "rust-inline.js");
    const inlineManifest = path.join(inlineRoot, "asset-manifest.json");
    const producer = {
      storePath: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-rust-wasm",
      outputIdentity: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-rust-wasm",
      sourceRevision: "b".repeat(64),
    };
    await fsp.mkdir(inlineRoot, { recursive: true });
    await fsp.writeFile(
      inline,
      `export const wasmProducer = ${JSON.stringify(producer)};\nexport const wasmBytes = () => new Uint8Array();\n`,
    );
    await fsp.writeFile(
      inlineManifest,
      '{"schemaVersion":"viberoots.node-wasm-assets.v1","assets":[]}\n',
    );
    appendWasmAssetManifestEntry(
      ":inline",
      inline,
      "lib/wasm/rust-inline.js",
      inline,
      inlineManifest,
    );
    assert.deepEqual(
      JSON.parse(await fsp.readFile(inlineManifest, "utf8")).assets[0].producer,
      producer,
    );
  });
});
