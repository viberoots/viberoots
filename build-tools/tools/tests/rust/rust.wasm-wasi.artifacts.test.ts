#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { exportGraphInTemp, runInTemp } from "../lib/test-helpers";
import { prepareFilteredViberootsInput } from "../lib/test-helpers/run-in-temp/filtered-inputs";
import { commandEnv } from "../viberoots/remote-consumer-boundary";
import { buildCanonicalBundle } from "./rust.source-selection.identity-bundle";
import {
  verifyCacheAndPatch,
  type WasmAcceptanceContext,
} from "./rust-wasm-acceptance-cache-patch";
import { writeRustWasmFixture } from "./rust-wasm-acceptance-fixture";
import {
  executeStaticDependencyConsumer,
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
    await pinTempViberootsInput(tmp, current, true);
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
    for (const name of names) {
      outputs.push(
        (
          await buildCanonicalBundle(
            tmp,
            "graph-generator-selected",
            current.storePath,
            process.env,
            `//projects/apps/rust-wasm:${name}`,
            tools,
            true,
          )
        ).outPath,
      );
    }
    const browser = path.join(outputs[0], "pkg");
    const component = path.join(outputs[1], "lib/rust_wasm_fixture.component.wasm");
    const raw = path.join(outputs[2], "lib/rust_wasm_fixture.wasm");
    const rawModule = await WebAssembly.instantiate(await fs.readFile(raw));
    assert.equal((rawModule.instance.exports.answer as () => number)(), 42);
    assert.equal((rawModule.instance.exports.dependency_answer as () => number)(), 42);
    assert.ok((await fs.stat(path.join(outputs[3], "lib/librust_wasm_fixture.a"))).size > 0);
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
    await verifyBrowserPackageInPinnedEngine(outputs[0], tmp);
    await verifyNodeStages(tmp, $, current.storePath);
    const debug = await buildCanonicalBundle(
      tmp,
      "graph-generator-selected",
      current.storePath,
      process.env,
      "//projects/apps/rust-wasm:browser_debug",
      tools,
      true,
    );
    await verifyProfilesAndComponent(tmp, $, outputs, debug.outPath, component, current.storePath);
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
    if (!allowMissingWasiToolchain) await verifyWasi(tmp, $, outputs[6], outputs[5], tools);
    const context: WasmAcceptanceContext = {
      tmp,
      command: $,
      root,
      outputs,
      debugOutput: debug.outPath,
      currentInput: current.storePath,
      artifactToolsRoot: tools,
      allowMissingWasiToolchain,
    };
    await verifyCacheAndPatch(context);
  });
});

async function verifyProfilesAndComponent(
  tmp: string,
  $: any,
  outputs: string[],
  debug: string,
  component: string,
  current: string,
): Promise<void> {
  await fs.access(path.join(debug, "pkg/rust_wasm_fixture_bg.wasm.map"));
  const packageJson = JSON.parse(await fs.readFile(path.join(debug, "pkg/package.json"), "utf8"));
  assert.ok(packageJson.files.includes("rust_wasm_fixture_bg.wasm.map"));
  const debugManifest = JSON.parse(
    await fs.readFile(path.join(debug, "share/viberoots-rust/wasm-manifest.json"), "utf8"),
  );
  assert.deepEqual(
    [debugManifest.optimize, debugManifest.debug, debugManifest.sourceMap],
    ["speed", true, true],
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(outputs[1], "share/viberoots-rust/wasm-manifest.json"), "utf8"),
  );
  assert.equal(
    String(
      await $`${path.join(manifest.tools.wasmtime, "bin/wasmtime")} run --invoke ${"add(2, 3)"} ${component}`,
    ).trim(),
    "5",
  );
  assert.equal(manifest.world, "calculator");
  assert.equal(manifest.adapter, "none");
  assert.match(
    await fs.readFile(path.join(outputs[1], "lib/rust_wasm_fixture.component.wit"), "utf8"),
    /export dependency-answer: func\(\) -> s32/,
  );
  const rebuilt = await buildCanonicalBundle(
    tmp,
    "graph-generator-selected",
    current,
    process.env,
    "//projects/apps/rust-wasm:component_rebuilt",
    canonicalArtifactToolsRoot(tmp),
    true,
  );
  assert.notEqual(rebuilt.outPath, outputs[1]);
  assert.deepEqual(
    await fs.readFile(path.join(rebuilt.outPath, "lib/rust_wasm_fixture.component.wasm")),
    await fs.readFile(component),
  );
}

async function verifyNegativeBuilds(tmp: string, current: string, tools: string): Promise<void> {
  for (const [name, pattern] of [
    ["bad_export", /export allowlist entry is absent: missing_export/],
    ["bad_component_export", /component exports do not exactly match exported_functions/],
    [
      "bad_component_interface_allowlist",
      /component exports do not exactly match exported_functions/,
    ],
    ["bad_component_ambiguous_functions", /ambiguous duplicate exported function names/],
    ["bad_world", /world.*absent|no world named.*absent/i],
  ] as const) {
    await assert.rejects(
      buildCanonicalBundle(
        tmp,
        "graph-generator-selected",
        current,
        process.env,
        `//projects/apps/rust-wasm:${name}`,
        tools,
        true,
      ),
      pattern,
    );
  }
}

async function verifyWasi(
  tmp: string,
  $: any,
  output: string,
  componentOutput: string,
  tools: string,
): Promise<void> {
  const wasm = path.join(output, "lib/rust_wasm_fixture.wasm");
  const runner = path.join(tmp, ".viberoots/current/build-tools/tools/wasm/wasi-runner.mjs");
  const hostileBin = path.join(tmp, "hostile-bin");
  await fs.mkdir(hostileBin, { recursive: true });
  await fs.writeFile(path.join(hostileBin, "node"), "#!/bin/sh\nexit 99\n");
  await fs.chmod(path.join(hostileBin, "node"), 0o755);
  const runtimeEnv = { ...commandEnv(tmp), PATH: hostileBin };
  const pinnedNode = path.join(tools, "bin/node");
  assert.match(
    String((await $({ env: runtimeEnv })`${pinnedNode} ${runner} ${wasm}`).stdout),
    /wasi-rust-42/,
  );
  const declared = await $({ env: runtimeEnv })`${path.join(output, "bin/wasi_demo")}`;
  assert.match(String(declared.stdout), /wasi-rust-42/);
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(componentOutput, "share/viberoots-rust/wasm-manifest.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.adapter, "wasi-preview1-reactor");
  const component = path.join(componentOutput, "lib/rust_wasm_fixture.component.wasm");
  await fs.access(component);
  assert.equal(
    String(
      await $`${path.join(manifest.tools.wasmtime, "bin/wasmtime")} run --invoke ${"add(20, 22)"} ${component}`,
    ).trim(),
    "42",
  );
}
