#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { exportGraphInTemp, runInTemp } from "../lib/test-helpers";
import { prepareFilteredViberootsInput } from "../lib/test-helpers/run-in-temp/filtered-inputs";
import { buildCanonicalBundleOutputs } from "./rust.source-selection.identity-bundle";
import { writeRustWasmFixture } from "./rust-wasm-acceptance-fixture";
import type { WasmAcceptanceContext } from "./rust-wasm-acceptance-cache-patch";
import { verifyPatchLifecycle } from "./rust-wasm-patch-lifecycle";
import { pinTempViberootsInput } from "./rust-immutable-current-input";
import { finalizeRustWasmRemoteGraph } from "./rust-wasm-remote-fixture";

const sourceRoot = path.resolve(path.basename(process.cwd()) === "viberoots" ? "." : "viberoots");

test("Rust WASM patch lifecycle changes every runtime family and restores lineage", async () => {
  await runInTemp("rust-wasm-patch-focused", async (tmp, $) => {
    const root = await writeRustWasmFixture(tmp, sourceRoot, $);
    await exportGraphInTemp({ tmp, $ });
    await finalizeRustWasmRemoteGraph(tmp, $);
    const current = await prepareFilteredViberootsInput(sourceRoot);
    await pinTempViberootsInput(tmp, current, true, $);
    const tools = canonicalArtifactToolsRoot(tmp);
    const outputs: string[] = [];
    const provenanceOutputs: string[] = [];
    for (const name of [
      "browser",
      "component",
      "raw",
      "static",
      "wasi_static",
      "wasi_component",
      "wasi_demo",
    ]) {
      const built = await buildCanonicalBundleOutputs(
        tmp,
        "graph-generator-selected",
        current.storePath,
        process.env,
        `//projects/apps/rust-wasm:${name}`,
        tools,
        true,
        ["out", "provenance"],
      );
      outputs.push(built.out.outPath);
      provenanceOutputs.push(built.provenance.outPath);
    }
    const context: WasmAcceptanceContext = {
      tmp,
      command: $,
      root,
      outputs,
      provenanceOutputs,
      debugOutput: outputs[0]!,
      currentInput: current.storePath,
      artifactToolsRoot: tools,
      allowMissingWasiToolchain: false,
    };
    await verifyPatchLifecycle(context, path.join(tools, "bin/nix"));
  });
});
