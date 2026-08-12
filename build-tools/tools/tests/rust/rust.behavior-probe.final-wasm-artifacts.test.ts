#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { exportGraphInTemp, runInTemp } from "../lib/test-helpers";
import { prepareFilteredViberootsInput } from "../lib/test-helpers/run-in-temp/filtered-inputs";
import { writeRustWasmFixture } from "./rust-wasm-acceptance-fixture";
import { finalizeRustWasmRemoteGraph } from "./rust-wasm-remote-fixture";
import { pinTempViberootsInput } from "./rust-immutable-current-input";
import { buildCanonicalBundle } from "./rust.source-selection.identity-bundle";

const sourceRoot = path.resolve(path.basename(process.cwd()) === "viberoots" ? "." : "viberoots");

test("behavior probes execute final browser and component WASM artifacts", async () => {
  const observer = await fs.readFile(
    path.join(sourceRoot, "build-tools/tools/nix/templates/rust-behavior-observer.nix"),
    "utf8",
  );
  assert.match(observer, /package="\$out\/pkg\/package\.json"/);
  assert.match(
    observer,
    /await import\(pathToFileURL\(path\.join\(root, `\$\{crate\}\.js`\)\)\.href\)/,
  );
  assert.match(observer, /bindings\.default\(await fs\.readFile\(path\.join\(root, wasmName\)\)\)/);
  assert.match(observer, /"\$out\/lib\/\$\{crate\}\.component\.wasm"/);
  assert.match(observer, /--invoke 'viberoots-observed-behavior\(\)'/);
  assert.doesNotMatch(
    observer,
    /builtins\.elem kind \[ "wasm" "wasm_browser" "wasm_component" \][\s\S]*\$out\/lib\/\$\{crate\}\.wasm/,
  );

  await runInTemp("rust-final-wasm-behavior", async (tmp, $) => {
    await writeRustWasmFixture(tmp, sourceRoot, $);
    await exportGraphInTemp({ tmp, $ });
    await finalizeRustWasmRemoteGraph(tmp, $);
    const current = await prepareFilteredViberootsInput(sourceRoot);
    await pinTempViberootsInput(tmp, current, true, $);
    const tools = canonicalArtifactToolsRoot(tmp);
    for (const target of ["browser", "component"]) {
      const output = await buildCanonicalBundle(
        tmp,
        "graph-generator-selected",
        current.storePath,
        process.env,
        `//projects/apps/rust-wasm:${target}`,
        tools,
        true,
      );
      const finalArtifact =
        target === "browser"
          ? path.join(output.outPath, "pkg/rust_wasm_fixture_bg.wasm")
          : path.join(output.outPath, "lib/rust_wasm_fixture.component.wasm");
      await fs.access(finalArtifact);
      const behavior = await fs.readFile(
        path.join(output.outPath, "share/viberoots-rust/observed-behavior"),
        "utf8",
      );
      assert.equal(behavior, "42");
      console.log(
        `[final-wasm-probe] target=${target} artifact=${finalArtifact} behavior=${behavior}`,
      );
    }
  });
});
