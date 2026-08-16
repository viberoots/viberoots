#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { reproducibilityMatrixIdsForArtifactFamily } from "../../lib/artifact-reproducibility-matrix";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const read = (relative: string) => fs.readFileSync(viberootsSourcePath(relative), "utf8");

test("Rust native lifecycle has one source-plan, runner, and runnable authority", () => {
  const defs = read("build-tools/rust/defs.bzl");
  const runner = read("build-tools/rust/private/nix_test.bzl");
  const planner = read("build-tools/tools/nix/planner/rust.nix");
  const composition = read("build-tools/tools/nix/planner/rust-composition.nix");
  const toolchains = read("build-tools/tools/nix/flake/packages/toolchains.nix");
  const enabledDiagnosis = read("build-tools/tools/dev/langs-diagnose/enabled.ts");
  const languageContracts = read("build-tools/tools/lib/lang-contracts.ts");
  const graphGenerator = read("build-tools/tools/nix/graph-generator.nix");
  const manifest = read("build-tools/tools/nix/planner/manifest.nix");
  assert.match(defs, /def rust_test/);
  assert.match(runner, /run_from_project_root = True/);
  assert.match(runner, /use_project_relative_paths = True/);
  assert.match(runner, /default_sec = 600/);
  assert.match(planner, /ctx\.sourcePlanFor node/);
  assert.match(planner, /ctx\.resolveNixpkgAttrs/);
  assert.match(composition, /Cargo path dependency/);
  assert.match(composition, /cross-root dependency cycle/);
  for (const macro of ["rust_static_library", "rust_cdylib", "rust_proc_macro"]) {
    assert.match(defs, new RegExp(`def ${macro}`));
  }
  assert.match(graphGenerator, /binaryNames/);
  assert.match(
    graphGenerator,
    /builtins\.elem \(LANGS\.rust\.kindOf \(builtins\.head matches\)\) \[ "bin" "tauri" "wasi" \]/,
  );
  assert.match(manifest, /\) rustOutPaths/);
  assert.match(manifest, /native-bin/);
  assert.match(toolchains, /wasm32-unknown-unknown/);
  assert.match(toolchains, /wasm32-wasip1/);
  assert.match(enabledDiagnosis, /languageEnablementGaps\(e\.hermetic\)/);
  assert.match(languageContracts, /"scaffold" \| "experimental" \| "graduated"/);
  assert.match(languageContracts, /experimentalHermeticBooleanKeys/);
  assert.match(languageContracts, /reproducibilityMatrixIds/);
});

test("Rust keeps external graduation gated after repository hermetic policy wiring", () => {
  const manifest = JSON.parse(read("build-tools/tools/nix/langs.json"));
  const rust = manifest.languages.find((entry: { id?: string }) => entry.id === "rust");
  assert.ok(rust);
  assert.ok(manifest.enabled.includes("rust"));
  assert.deepEqual(rust.kinds, ["app", "bin", "lib", "test", "pyext_wasm", "wasm", "wasi"]);
  assert.equal(rust.hermetic.status, "experimental");
  assert.equal(rust.hermetic.sandboxNetwork, true);
  assert.equal(rust.hermetic.remoteExecution, true);
  assert.equal(rust.hermetic.publicationAdmission, false);
  assert.match(rust.supportNotes.remoteExecution, /remote snapshot/);
  assert.match(rust.supportNotes.remoteExecution, /rust-pyodide-extension-pr14/);
  assert.match(rust.supportNotes.publicationAdmission, /external release admission remains false/);
  assert.deepEqual(
    rust.hermetic.reproducibilityMatrixIds,
    reproducibilityMatrixIdsForArtifactFamily("rust"),
  );
  assert.ok(fs.existsSync(viberootsSourcePath(rust.templatesDir.replace(/^viberoots\//, ""))));
  for (const requiredPath of rust.requiredPaths) {
    assert.ok(fs.existsSync(viberootsSourcePath(requiredPath.replace(/^viberoots\//, ""))));
  }
});

test("Rust public macros share the bounded artifact behavior observation contract", () => {
  const defs = read("build-tools/rust/defs.bzl");
  const macroContract = read("build-tools/rust/private/macro_contract.bzl");
  const runtimeContract = read("build-tools/rust/private/runtime_contract.bzl");
  const buildAttrs = read("build-tools/rust/private/nix_build_attrs.bzl");
  const testRule = read("build-tools/rust/private/nix_test.bzl");
  const planner = read("build-tools/tools/nix/planner/rust.nix");
  const observer = read("build-tools/tools/nix/templates/rust-behavior-observer.nix");
  const starlarkApi = read("docs/handbook/starlark-api.md");
  const rustDevelopment = read("docs/handbook/rust-development.md");
  const tauriDevelopment = read("docs/handbook/rust-tauri-development.md");
  const applicableMacros = [
    "rust_library",
    "rust_static_library",
    "rust_cdylib",
    "rust_c_ffi_library",
    "rust_cxx_bridge_library",
    "rust_proc_macro",
    "rust_binary",
    "rust_test",
    "tauri_app",
    "rust_wasm_library",
    "rust_wasi_binary",
    "rust_wasm_static_library",
    "rust_wasm_browser_package",
    "rust_wasm_component",
    "rust_python_extension",
    "rust_node_addon",
  ];
  for (const [index, macro] of applicableMacros.entries()) {
    const start = defs.indexOf(`def ${macro}(`);
    const end = defs.indexOf("\ndef ", start + 1);
    assert.notEqual(start, -1, `missing public macro ${macro}`);
    assert.match(
      defs.slice(start, end === -1 ? undefined : end),
      /_rust_nix_target\(/,
      `${macro} must use the shared observer-capable build path at index ${index}`,
    );
  }
  assert.match(macroContract, /RUST_PUBLIC_ARGS = \[[\s\S]*"behavior_probe"/);
  assert.match(defs, /behavior_probe = kw\.pop\("behavior_probe", False\)/);
  assert.match(runtimeContract, /behavior_probe must be a bool/);
  assert.match(buildAttrs, /"behavior_probe": attrs\.bool\(default = False\)/);
  assert.match(testRule, /"behavior_probe": attrs\.bool\(default = False\)/);
  assert.match(planner, /behaviorProbe = ctx\.get node "behavior_probe"/);
  assert.match(observer, /viberoots_observed_behavior/);
  assert.match(observer, /case "\$behavior" in 42\|43/);
  assert.match(observer, /share\/viberoots-rust\/observed-behavior/);
  assert.match(starlarkApi, /narrow reproducibility-qualification API/);
  assert.match(starlarkApi, /accepts no\s+command, path, environment, or expected-value override/);
  assert.match(rustDevelopment, /Protected behavior observation/);
  assert.match(tauriDevelopment, /frontend WASM recovered from the\s+packaged `\.app`/);
});

test("Rust native support claims only reviewed source-registry systems and withholds Linux execution", () => {
  const registry = read("build-tools/tools/nix/nixpkgs-source-registry.nix");
  const design = read("build-tools/docs/lang/rust-design.md");
  for (const system of ["aarch64-darwin", "aarch64-linux", "x86_64-linux"]) {
    assert.match(registry, new RegExp(`"${system}"`));
  }
  assert.match(design, /native execution evidence only for `aarch64-darwin`/);
  assert.match(design, /Linux support remains unclaimed/);
  assert.match(
    design,
    /native, raw\/WASI WASM, WASM static-library, browser-package, and component kinds dispatches/,
  );
  assert.match(
    design,
    /`rust_wasm_library`[\s\S]*produces a deterministic `\.wasm`[\s\S]*`rust_wasi_binary`[\s\S]*materializes the selected `\.wasm`/,
  );
  assert.match(
    design,
    /Native and WASI binaries publish `runnable\.kind = "native-bin"` and `run\.prod`/,
  );
  assert.match(
    design,
    /executable wrapper that launches the module through the checked-in WASI runner/,
  );
});

test("Tauri scaffold lifecycle drains production launch output while waiting for packaged app", () => {
  const fixture = read("build-tools/tools/tests/rust/rust.tauri-scaffold-lifecycle.fixture.ts");
  assert.match(fixture, /child\.stdout\?\.on\("data"/);
  assert.match(fixture, /child\.stderr\?\.on\("data"/);
  assert.match(fixture, /appendBoundedOutput/);
  assert.match(fixture, /appExecutable=/);
});
