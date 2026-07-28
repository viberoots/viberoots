#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { selectWasmCacheOutputs } from "./rust-wasm-acceptance-cache-patch";
import { groupWasmCacheManifests } from "./rust-wasm-cache-manifests";

test("Rust WASM cache selection includes every available lane output", () => {
  const local = ["browser", "component", "raw", "static"];
  assert.deepEqual(selectWasmCacheOutputs(local, "debug", true), [...local, "debug"]);

  const full = [...local, "wasi-static", "wasi-component", "wasi-binary"];
  assert.deepEqual(selectWasmCacheOutputs(full, "debug", false), [...full, "debug"]);
  assert.throws(() => selectWasmCacheOutputs(local, "debug", false));
});

test("cache replay preserves distinct selected-source proof groups", () => {
  const manifests = groupWasmCacheManifests([
    manifest("/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source", "/nix/store/browser"),
    manifest("/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-source", "/nix/store/raw"),
    manifest("/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source", "/nix/store/debug"),
  ]);
  assert.deepEqual(
    manifests.map((entry) => [entry.sourceSnapshot, entry.storePaths.map((path) => path.path)]),
    [
      [
        "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source",
        ["/nix/store/browser", "/nix/store/debug"],
      ],
      ["/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-source", ["/nix/store/raw"]],
    ],
  );
});

function manifest(sourceSnapshot: string, output: string) {
  return {
    schemaVersion: "viberoots.nix-store-materialization.v1",
    sourceRevision: "fixture",
    sourceSnapshot,
    flakeLockFingerprint: "fixture-lock",
    storePaths: [
      {
        attr: output.slice("/nix/store/".length),
        path: output,
        expectedOutputIdentity: output.slice("/nix/store/".length),
      },
    ],
    tools: { nix: "/nix/store/cccccccccccccccccccccccccccccccc-nix" },
    substituter: { endpointIdentity: "", trustedPublicKeys: [] },
  };
}
