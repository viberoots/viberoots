#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nonRunnableTargetReason } from "../../dev/run-runnable-core";

const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const read = (relative: string) => fsp.readFile(path.join(sourceRoot, relative), "utf8");

test("shared runnable routing admits only canonical Rust Tauri apps", () => {
  const base = {
    importer: "",
    mode: "static" as const,
    framework: "",
    targetKind: "app",
  };
  assert.equal(nonRunnableTargetReason({ ...base, language: "rust", tauri: true }), "");
  assert.equal(nonRunnableTargetReason({ ...base, language: "rust", tauri: false }), "app-only");
  assert.equal(
    nonRunnableTargetReason({
      ...base,
      targetKind: "lib",
      language: "rust",
      tauri: true,
    }),
    "lib-only",
  );
});

test("shared p seals recorded source authority before Tauri pnpm prebuild", async () => {
  const source = await read("build-tools/tools/dev/run-runnable-source.ts");
  const graph = await read("build-tools/tools/dev/run-runnable-graph.ts");
  assert.match(source, /path\.join\(artifactToolsRoot,\s*"share",\s*"viberoots-source"\)/);
  assert.match(
    source,
    /canonicalRunnableViberootsSource\([\s\S]*makeFilteredFlakeRef\(\{[\s\S]*immutableViberootsInputRoot/,
  );
  assert.doesNotMatch(
    source,
    /process\.env\.VIBEROOTS_FLAKE_INPUT_ROOT|VIBEROOTS_FLAKE_INPUT_ROOT:/,
    "shared p must seal recorded authority rather than forward an ambient selector",
  );
  assert.match(
    graph,
    /const source = await chooseRunnableFlakeRef\([\s\S]*await resolveFinalPnpmStore\(/,
    "Tauri's importer prebuild must consume the sealed evaluation-bundle flake",
  );
});

test("composition evidence uses the public runnable output channel", async () => {
  const desktop = await read("projects/apps/tauri-composition-app/src/main.rs");
  const frontend = await read("projects/apps/tauri-composition-app/composition.js");
  const lifecycle = await read(
    "build-tools/tools/tests/rust/rust.tauri-composition.behavior.test.ts",
  );
  assert.match(desktop, /VIBEROOTS_TAURI_COMPOSITION_EVIDENCE/);
  assert.match(desktop, /VIBEROOTS_TAURI_COMPOSITION_FAILURE/);
  assert.match(desktop, /stdout\(\)\.lock\(\)/);
  assert.doesNotMatch(desktop, /std::env|TAURI_COMPOSITION_EVIDENCE_PATH/);
  assert.match(frontend, /report_composition_failure/);
  assert.match(frontend, /@tauri-apps\/api\/core/);
  assert.doesNotMatch(frontend, /window\.__TAURI__/);
  assert.match(lifecycle, /stdio: \["ignore", "pipe", "pipe"\]/);
  assert.match(lifecycle, /line\.startsWith\(evidencePrefix\)/);
  assert.match(lifecycle, /line\.startsWith\(failurePrefix\)/);
  assert.doesNotMatch(lifecycle, /TAURI_COMPOSITION_EVIDENCE_PATH/);
});

test("canonical Node planning preserves reviewed node_asset_stage mappings", async () => {
  const macro = await read("build-tools/node/defs.bzl");
  const assetContract = await read("build-tools/node/private/asset_contract.bzl");
  const nodePlanner = await read("build-tools/tools/nix/planner/node.nix");
  const webappPlanner = await read("build-tools/tools/nix/planner/node-webapp.nix");
  const assetPlanner = await read("build-tools/tools/nix/planner/node-assets.nix");
  const tauriTargets = await read("projects/apps/tauri-composition-app/TARGETS");
  assert.match(macro, /asset_metadata/);
  assert.match(assetContract, /node-asset-v5\|/);
  assert.match(assetPlanner, /node-asset-v5\|/);
  assert.match(assetPlanner, /builtins\.length fields != 8/);
  assert.match(tauriTargets, /"dest": "frontend\.wasm"/);
  assert.match(assetContract, /duplicate asset destination/);
  assert.match(assetContract, /destination must stay inside the staged output/);
  assert.match(assetContract, /source_path must stay inside its source root/);
  assert.match(macro, /app_metadata[\s\S]*merged_deps/);
  assert.match(nodePlanner, /dependencyArtifactOf[\s\S]*node-webapp\.nix/);
  assert.match(assetPlanner, /isWasm && isSameCellLabel[\s\S]*dependencyArtifactOf/);
  assert.match(assetPlanner, /isViberootsSource[\s\S]*rawLabelPath viberootsStoreRoot/);
  assert.match(assetPlanner, /expected exactly one reviewed artifact/);
  assert.match(assetPlanner, /asset destination escaped dist/);
  assert.match(assetPlanner, /asset destination collision/);
  assert.match(webappPlanner, /stageAppArtifact[\s\S]*STAGE_APP_ARTIFACT/);
  assert.match(webappPlanner, /cp -R "\$STAGE_APP_ARTIFACT\/dist\/\." dist\//);
  assert.match(webappPlanner, /stage_wasm_contract[\s\S]*\$\{stageAssets\}/);
});

test("selected Tauri invalidation inspection stays inside canonical artifact ingress", async () => {
  const selected = await read("build-tools/tools/dev/build-selected.ts");
  const invalidation = await read(
    "build-tools/tools/tests/rust/rust.tauri-input-invalidation.behavior.test.ts",
  );
  assert.match(selected, /getFlagBool\("print-derivation-identity"\)/);
  assert.match(selected, /artifactNixPolicyArgs\(\)/);
  assert.match(
    selected,
    /flakeSource\.flakeRef[\s\S]*package: \[ package\.drvPath package\.\$\{derivationOutput\} \]/,
  );
  assert.doesNotMatch(selected, /print-derivation-identity[\s\S]{0,500}VIBEROOTS_FLAKE_INPUT_ROOT/);
  assert.match(
    invalidation,
    /`\$\{\[\s*"build-selected",\s*`--artifact-workspace-root=\$\{consumer\}`,\s*"--target",\s*target,\s*"--source=path",\s*"--print-derivation-identity",\s*\]\}`/,
  );
  assert.doesNotMatch(invalidation, /`\s*\n\s*build-selected\s*\n/);
});

test("composed Rust roots retain transitive reviewed native link inputs", async () => {
  const planner = await read("build-tools/tools/nix/planner/rust.nix");
  const bridge = await read("projects/libs/tauri-composition-providers/bridge/src/lib.rs");
  const desktopCargo = await read("projects/apps/tauri-composition-app/Cargo.toml");
  const tauriPlanner = await read("build-tools/tools/nix/planner/rust-tauri.nix");
  const tauriTemplate = await read("build-tools/tools/nix/templates/rust-tauri.nix");
  assert.match(planner, /nativeInputsFor \(map \(root: root\.label\) sourceComposition\.roots\)/);
  assert.match(planner, /linkNames = map sanitizeNativeLinkName resolved/);
  assert.match(planner, /kind = if mode == "shared" then "dylib" else "static"/);
  assert.match(bridge, /intrinsic_abi::composition_native_answer/);
  assert.doesNotMatch(bridge, /__viberoots_abi/);
  assert.match(desktopCargo, /\[\[bin\]\]\nname = "desktop"\npath = "src\/main\.rs"/);
  assert.match(tauriTemplate, /\.app\.withGlobalTauri == false/);
  assert.match(tauriTemplate, /appWindows/);
  assert.match(tauriTemplate, /withGlobalTauri:false/);
  assert.match(tauriPlanner, /relative == "projects"/);
  assert.match(tauriPlanner, /lib\.hasPrefix "projects\/" relative/);
});
