#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { exportGraphInTemp, runInTemp } from "../lib/test-helpers";
import { prepareFilteredViberootsInput } from "../lib/test-helpers/run-in-temp/filtered-inputs";
import { buildCanonicalBundleOutputs } from "./rust.source-selection.identity-bundle";
import {
  verifyCacheAndPatch,
  type WasmAcceptanceContext,
} from "./rust-wasm-acceptance-cache-patch";
import { writeRustWasmFixture } from "./rust-wasm-acceptance-fixture";
import {
  executeStaticDependencyConsumer,
  verifyRewrittenStaticArchiveConsumers,
  verifyProducerAndCppConsumerDirections,
  verifyTinyGoConsumer,
  verifyWasiCrossLanguageDirections,
} from "./rust-wasm-cross-language-runtime";
import { pinTempViberootsInput } from "./rust-immutable-current-input";
import { verifyNodeStages } from "./rust-wasm-node-staging";
import { verifyBrowserPackageInPinnedEngine } from "./rust-wasm-browser-runtime";
import { verifyWasmControls } from "./rust-wasm-controls-runtime";
import { finalizeRustWasmRemoteGraph } from "./rust-wasm-remote-fixture";
import { verifyRustWasmRemoteReadiness } from "./rust-wasm-remote-runtime";
import {
  verifyNegativeBuilds,
  verifyProfilesAndComponent,
  verifyRuntimeReferenceBoundaries,
  verifyWasi,
} from "./rust-wasm-acceptance-verification";

const sourceRoot = path.resolve(path.basename(process.cwd()) === "viberoots" ? "." : "viberoots");
const allowMissingWasiToolchain = process.argv.includes("--allow-missing-wasi-toolchain");
const remoteOnly = process.argv.includes("--remote-only");
const wasiStaticConsumerOnly = process.argv.includes("--wasi-static-consumer-only");

test("Rust freestanding and WASI macros produce executable WebAssembly", async () => {
  await runInTemp("rust-wasm-wasi", async (tmp, $) => {
    const root = await writeRustWasmFixture(tmp, sourceRoot, $);
    await exportGraphInTemp({ tmp, $ });
    await finalizeRustWasmRemoteGraph(tmp, $);
    const current = await prepareFilteredViberootsInput(sourceRoot);
    await pinTempViberootsInput(tmp, current, true, $);
    const tools = canonicalArtifactToolsRoot(tmp);
    if (wasiStaticConsumerOnly) {
      assert.equal(await executeStaticDependencyConsumer(tmp, current.storePath, tools, true), 42);
      return;
    }
    if (remoteOnly) {
      await verifyRustWasmRemoteReadiness(tmp, $, current.storePath, tools);
      return;
    }
    const names = ["browser", "component", "raw", "static"];
    if (!allowMissingWasiToolchain) names.push("wasi_static", "wasi_component", "wasi_demo");
    const outputs: string[] = [];
    const provenanceOutputs: string[] = [];
    for (const name of names) {
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
    const browser = path.join(outputs[0], "pkg");
    const component = path.join(outputs[1], "lib/rust_wasm_fixture.component.wasm");
    for (const output of outputs.slice(0, 2)) {
      assert.equal(
        await fs.readFile(path.join(output, "share/viberoots-rust/observed-behavior"), "utf8"),
        "42",
      );
    }
    const raw = path.join(outputs[2], "lib/rust_wasm_fixture.wasm");
    const rawModule = await WebAssembly.instantiate(await fs.readFile(raw));
    assert.equal((rawModule.instance.exports.answer as () => number)(), 42);
    assert.equal((rawModule.instance.exports.dependency_answer as () => number)(), 42);
    assert.ok((await fs.stat(path.join(outputs[3], "lib/librust_wasm_fixture.a"))).size > 0);
    await verifyRewrittenStaticArchiveConsumers(
      tmp,
      current.storePath,
      tools,
      !allowMissingWasiToolchain,
    );
    const bindings = await import(pathToFileURL(path.join(browser, "rust_wasm_fixture.js")).href);
    await bindings.default(await fs.readFile(path.join(browser, "rust_wasm_fixture_bg.wasm")));
    assert.equal(bindings.answer(), 42);
    assert.equal(bindings.dependency_answer(), 42);
    assert.equal(bindings.add, undefined);
    const browserExports = WebAssembly.Module.exports(
      await WebAssembly.compile(await fs.readFile(path.join(browser, "rust_wasm_fixture_bg.wasm"))),
    ).map((entry) => entry.name);
    assert.equal(browserExports.includes("add"), false);
    await fs.access(path.join(browser, "rust_wasm_fixture.d.ts"));
    assert.match(
      await fs.readFile(path.join(browser, "browser-harness.html"), "utf8"),
      /documentElement\.dataset\.viberootsWasm = "ready"/,
    );
    await verifyBrowserPackageInPinnedEngine(outputs[0], provenanceOutputs[0], tmp);
    await verifyNodeStages(tmp, $, current.storePath);
    const debugOutputs = await buildCanonicalBundleOutputs(
      tmp,
      "graph-generator-selected",
      current.storePath,
      process.env,
      "//projects/apps/rust-wasm:browser_debug",
      tools,
      true,
      ["out", "provenance"],
    );
    const debug = debugOutputs.out;
    const debugProvenance = debugOutputs.provenance;
    await verifyRuntimeReferenceBoundaries(
      tmp,
      $,
      outputs,
      debug.outPath,
      tools,
      allowMissingWasiToolchain,
    );
    await verifyProfilesAndComponent(
      tmp,
      $,
      outputs,
      provenanceOutputs,
      debug.outPath,
      debugProvenance.outPath,
      component,
      current.storePath,
    );
    await verifyWasmControls(tmp, $, current.storePath, tools);
    await verifyTinyGoConsumer(tmp, current.storePath, tools);
    await verifyProducerAndCppConsumerDirections(tmp, current.storePath, tools);
    if (!allowMissingWasiToolchain) {
      await verifyWasiCrossLanguageDirections(tmp, current.storePath, tools);
    }
    if (!allowMissingWasiToolchain) {
      await verifyRustWasmRemoteReadiness(tmp, $, current.storePath, tools);
    }
    await verifyNegativeBuilds(tmp, current.storePath, tools);
    if (!allowMissingWasiToolchain)
      await verifyWasi(tmp, $, outputs[6], outputs[5], provenanceOutputs[5], tools);
    const context: WasmAcceptanceContext = {
      tmp,
      command: $,
      root,
      outputs,
      provenanceOutputs,
      debugOutput: debug.outPath,
      debugProvenanceOutput: debugProvenance.outPath,
      currentInput: current.storePath,
      artifactToolsRoot: tools,
      allowMissingWasiToolchain,
    };
    await verifyCacheAndPatch(context);
  });
});
