#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.join(process.cwd(), "viberoots");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

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
    /builtins\.elem \(LANGS\.rust\.kindOf \(builtins\.head matches\)\) \[ "bin" "wasi" \]/,
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

test("Rust is enabled only through its reviewed experimental native and WASM lifecycle", () => {
  const manifest = JSON.parse(read("build-tools/tools/nix/langs.json"));
  const rust = manifest.languages.find((entry: { id?: string }) => entry.id === "rust");
  assert.ok(rust);
  assert.ok(manifest.enabled.includes("rust"));
  assert.deepEqual(rust.kinds, ["bin", "lib", "test", "wasm", "wasi"]);
  assert.equal(rust.hermetic.status, "experimental");
  assert.deepEqual(rust.hermetic.reproducibilityMatrixIds, ["rust-pr5"]);
  assert.ok(fs.existsSync(path.join(root, rust.templatesDir.replace(/^viberoots\//, ""))));
  for (const requiredPath of rust.requiredPaths) {
    assert.ok(fs.existsSync(path.join(process.cwd(), requiredPath)), requiredPath);
  }
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
    /`kind:bin`, `kind:lib`, `kind:test`, `kind:wasm`, or `kind:wasi` dispatches/,
  );
  assert.match(design, /`kind:wasm` and `kind:wasi` targets materialize the selected `\.wasm`/);
  assert.match(
    design,
    /Native and WASI binaries publish `runnable\.kind = "native-bin"` and `run\.prod`/,
  );
  assert.match(
    design,
    /executable wrapper that launches the module through the checked-in WASI runner/,
  );
});
