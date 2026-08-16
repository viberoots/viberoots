#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { protectedRustPatchCaseDefinitions } from "../../ci/protected-rust-patch-case-driver";
import { RELEASE_BUILDER_SYSTEMS } from "../../lib/artifact-reproducibility-matrix";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const read = (relative: string) => fs.readFileSync(viberootsSourcePath(relative), "utf8");

test("Rust Pyodide scaffold lifecycle is covered in both source modes", () => {
  const fixture = read("build-tools/tools/tests/rust/rust.pyodide-scaffold-lifecycle.fixture.ts");
  const flake = read("build-tools/tools/tests/rust/rust.pyodide-scaffold-flake.lifecycle.test.ts");
  const submodule = read(
    "build-tools/tools/tests/rust/rust.pyodide-scaffold-submodule.lifecycle.test.ts",
  );
  for (const token of [
    "scaf new rust pyodide-extension rust_pyodide_demo --dry-run --yes",
    "scaf new rust pyodide-extension rust_pyodide_demo --yes",
    "u`",
    "i --without-secrets",
    "buildSelectedOutPath",
    'phase("selected build"',
    "RUST_PYODIDE_VALUE=",
    "patch-pkg",
    "apply rust ${patchDep}",
    "remove rust ${patchDep}",
    "activateTauriSubmodule",
    "makeConsumer",
  ]) {
    assert.ok(fixture.includes(token), `missing lifecycle token ${token}`);
  }
  assert.match(flake, /runRustPyodideScaffoldLifecycle\(tmp, "flake", \$\)/);
  assert.match(submodule, /runRustPyodideScaffoldLifecycle\(tmp, "submodule", \$\)/);
});

test("Rust Pyodide protected evidence participates in every release builder slot", () => {
  for (const system of RELEASE_BUILDER_SYSTEMS) {
    const pyodide = protectedRustPatchCaseDefinitions(system).find(
      ({ id }) => id === "rust-pyodide-extension-pr14",
    );
    assert.ok(pyodide, `missing Rust Pyodide protected patch case for ${system}`);
    assert.equal(pyodide.cargoRoot, "projects/apps/repro-rust-pyodide");
    assert.equal(pyodide.targetName, "repro-rust-pyodide-ext");
    assert.deepEqual(pyodide.matrixCase.coverage.routeCapabilities, ["wasm", "addon", "mixed"]);
    assert.deepEqual(pyodide.matrixCase.languageProofs[0]?.requiredLabels, [
      "lang:rust",
      "kind:pyext_wasm",
      "backend:pyodide",
    ]);
  }
});

test("Rust Pyodide execution parity is required across selected, filtered, remote, and cache paths", () => {
  const importRun = read(
    "build-tools/tools/tests/rust/rust.python-wasm-extension.unsupported-abi.test.ts",
  );
  const patchRun = read(
    "build-tools/tools/tests/rust/rust.python-wasm-extension.patch-workflow.test.ts",
  );
  const remoteCache = read(
    "build-tools/tools/tests/rust/rust.extensions.remote-cache-materialization.test.ts",
  );
  const matrix = read("build-tools/tools/lib/artifact-reproducibility-rust-matrix.ts");
  const design = read("build-tools/docs/build-system-design.md");
  assert.match(importRun, /RUST_VALUE=47/);
  assert.match(importRun, /materialization-manifest\.json/);
  assert.match(patchRun, /baseline\.value, 42/);
  assert.match(patchRun, /patched\.value, 43/);
  assert.match(patchRun, /assert\.deepEqual\(restored, baseline\)/);
  assert.match(remoteCache, /remote preparation and a credential-free binary cache handoff/);
  assert.match(remoteCache, /poisoned live source/);
  assert.match(remoteCache, /materializeNixStorePaths/);
  assert.match(remoteCache, /viberoots-python-wasm\/materialization-manifest\.json/);
  assert.match(remoteCache, /pyodideManifest/);
  assert.match(remoteCache, /readPyodideAbi/);
  assert.doesNotMatch(remoteCache, /store add-path --name rust-pyodide-cache/);
  assert.match(matrix, /rust-pyodide-extension-pr14/);
  assert.match(matrix, /"wasm", "addon", "mixed"/);
  assert.match(design, /Rust Pyodide extensions now use the pinned PyEmscripten ABI/);
  assert.match(
    design,
    /selected, filtered\/remote-prepared, exported-cache, and cold imported-cache/,
  );
  assert.doesNotMatch(design, /Python WASM extensions fail closed until the pinned toolchains/u);
});

test("Rust Pyodide static link deps compare explicit WASM producer authority", () => {
  const planner = read("build-tools/tools/nix/planner/rust-pyemscripten-inputs.nix");
  for (const token of [
    "wasm_abi",
    "wasm_target",
    "wasm_libc",
    "wasm_exception_policy",
    "wasm_allocator",
    "wasm_runtime",
    "nixpkgs_profile",
    "nixpkg_pins",
    "expected wasm32-unknown-unknown",
    "expected link-only",
    "incompatible nixpkg_pins authority",
  ]) {
    assert.ok(planner.includes(token), `missing PyEmscripten link authority token ${token}`);
  }
});

test("Rust Pyodide protected evidence avoids Rust-only artifact paths", () => {
  const phase = [
    read("build-tools/tools/ci/protected-rust-patch-phase.ts"),
    read("build-tools/tools/ci/protected-rust-patch-pyodide-phase.ts"),
  ].join("\n");
  const sources = read("build-tools/tools/ci/protected-rust-patch-consumer-sources.ts");
  const evidence = read("build-tools/tools/ci/protected-rust-patch-pyodide-evidence.ts");
  const driver = read("build-tools/tools/ci/protected-rust-patch-case-driver.ts");
  assert.match(phase, /BUILD-INFO\.json/);
  assert.match(phase, /pyemscripten-abi\.json/);
  const semantic = read("build-tools/tools/ci/artifact-reproducibility-semantic-manifest.ts");
  assert.match(semantic, /sbom\.spdx\.json/);
  assert.match(semantic, /python-wasm-provenance\.v1/);
  assert.match(phase, /bin", "run\.mjs"/);
  assert.match(driver, /runWithRemoteStore/);
  assert.match(phase, /consumerKind: buildInfo\.kind/);
  assert.doesNotMatch(phase, /semanticDigest: digest\(buildInfoBytes\)/);
  assert.match(sources, /definition\.id === "rust-pyodide-extension-pr14"/);
  assert.match(sources, /Ok\(\$\{protectedCrate\}::observed\(\)\)/);
  assert.match(evidence, /pyodideBehaviorDigest !== digest/);
  assert.match(evidence, /pyodideAbiDigest !== digest/);
  assert.match(evidence, /consumerKind.*wasm-app/s);
  assert.match(evidence, /backend.*pyodide/s);
  assert.match(evidence, /abiTarget.*wasm32-unknown-emscripten/s);
  assert.match(evidence, /exceptionPolicy.*python-c-api/s);
});

test("Rust Pyodide handbook documents operator backout steps", () => {
  const rustDevelopment = read("docs/handbook/rust-development.md");
  const troubleshooting = read("docs/handbook/troubleshooting.md");
  for (const doc of [rustDevelopment, troubleshooting]) {
    assert.match(doc, /pyodide-extension/i);
    assert.match(doc, /backout/i);
    assert.match(doc, /run `u`/i);
    assert.match(doc, /i && b && v/i);
  }
  assert.match(rustDevelopment, /remove the Python WASM consumer/i);
  assert.match(troubleshooting, /do not hand-edit materialization manifests/i);
});
