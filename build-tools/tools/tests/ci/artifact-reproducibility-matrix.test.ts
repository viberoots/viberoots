import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX,
  ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
  assertReproducibilityMatrixBinding,
  hasReproducibilityMatrixId,
  reproducibilityMatrixCaseCoversLanguage,
} from "../../lib/artifact-reproducibility-matrix";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("reproducibility matrix IDs are unique and cover every required family", async () => {
  const ids = ARTIFACT_REPRODUCIBILITY_MATRIX.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    [...new Set(ARTIFACT_REPRODUCIBILITY_MATRIX.map((entry) => entry.artifactFamily))].sort(),
    ["cpp", "go", "mixed", "node", "python", "rust", "wasm"],
  );
  assert.equal(hasReproducibilityMatrixId("go-lib"), true);
  assert.equal(hasReproducibilityMatrixId("invented"), false);
  assert.equal(reproducibilityMatrixCaseCoversLanguage("go-lib", "go"), true);
  assert.equal(reproducibilityMatrixCaseCoversLanguage("go-lib", "python"), false);
  assert.match(ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST, /^sha256:[a-f0-9]{64}$/u);
  for (const entry of ARTIFACT_REPRODUCIBILITY_MATRIX) {
    assert.equal(entry.graphSelection.attr, "graph-generator-selected");
    assert.ok(entry.graphSelection.ruleTypes.length > 0);
    assert.ok(
      entry.graphSelection.requiredLabels.every((label) => !label.startsWith("reproducibility:")),
    );
    assert.ok(entry.graphSelection.outputRole);
    assert.ok(entry.graphSelection.target.startsWith("//projects/"));
    assert.ok(
      entry.scaffoldRecipe.destination === "projects" ||
        entry.scaffoldRecipe.destination.startsWith("projects/"),
    );
    assert.match(entry.scaffoldRecipe.name, /^repro-/u);
    assert.equal("languageIds" in entry.coverage, false);
    assert.ok(
      [entry.graphSelection, ...entry.languageProofs].some(({ requiredLabels }) =>
        requiredLabels.some((label) => label.startsWith("lang:")),
      ),
    );
    assert.ok(entry.coverage.routeCapabilities.length);
  }
  const mixed = ARTIFACT_REPRODUCIBILITY_MATRIX.find(({ id }) => id === "mixed-artifact")!;
  assert.equal(mixed.scaffoldRecipe.destination, "projects");
  assert.equal(mixed.graphSelection.target, "//projects/libs/repro-mixed-ts:repro-mixed_ts_pkg");
  assert.equal(reproducibilityMatrixCaseCoversLanguage("mixed-artifact", "cpp"), true);
  assert.equal(reproducibilityMatrixCaseCoversLanguage("mixed-artifact", "go"), true);
  assert.equal(reproducibilityMatrixCaseCoversLanguage("mixed-artifact", "node"), true);
  assert.deepEqual(mixed.nodeArtifact, {
    format: "esm-with-native-addon",
    sourcePath: "projects/libs/repro-mixed-ts/src/node/index.ts",
    outputPaths: ["dist/node/index.mjs", "dist/native/napi_addon.node"],
    toolchainAuthority: "nix-store-nodejs-22",
    nativeClosureTarget: "//projects/libs/repro-mixed-native:napi_addon",
  });
  const node = ARTIFACT_REPRODUCIBILITY_MATRIX.find(({ id }) => id === "node-artifact")!;
  assert.deepEqual(node.nodeArtifact, {
    format: "esm",
    sourcePath: "projects/libs/repro-node/src/index.ts",
    outputPaths: ["dist/index.mjs"],
    toolchainAuthority: "nix-store-nodejs-22",
  });
  const nodePlanner = await fs.readFile(
    viberootsSourcePath("build-tools/tools/nix/planner/node-genlike.nix"),
    "utf8",
  );
  assert.match(nodePlanner, /export VBR_NODE_BIN=\$\{pkgs\.nodejs_22\}\/bin\/node/);
  const wasm = ARTIFACT_REPRODUCIBILITY_MATRIX.find(({ id }) => id === "wasm-artifact")!;
  assert.deepEqual(wasm.graphSelection.ruleTypes, ["python_nix_wasm_build"]);
  const rust = ARTIFACT_REPRODUCIBILITY_MATRIX.find(({ id }) => id === "rust-pr5")!;
  assert.deepEqual(rust.systems, ["aarch64-darwin", "aarch64-linux", "x86_64-linux"]);
  assert.deepEqual(rust.systemEvidence, {
    nativeExecution: ["aarch64-darwin"],
    failClosedUntilExternalEvidence: ["aarch64-linux", "x86_64-linux"],
  });
  assert.deepEqual(rust.coverage.routeCapabilities, ["base"]);
  assert.deepEqual(rust.languageProofs, []);
  assert.equal(reproducibilityMatrixCaseCoversLanguage("rust-pr5", "rust"), true);
  const rustPr12 = ARTIFACT_REPRODUCIBILITY_MATRIX.filter(({ id }) => id.endsWith("-pr12"));
  assert.deepEqual(
    rustPr12.map(({ id }) => id),
    [
      "rust-test-pr12",
      "rust-lib-pr12",
      "rust-static-library-pr12",
      "rust-cdylib-pr12",
      "rust-proc-macro-pr12",
      "rust-python-extension-pr12",
      "rust-node-addon-pr12",
      "rust-c-ffi-pr12",
      "rust-cxx-bridge-pr12",
      "rust-wasm-pr12",
      "rust-wasm-static-pr12",
      "rust-wasi-static-pr12",
      "rust-wasm-browser-pr12",
      "rust-wasm-component-pr12",
      "rust-wasi-pr12",
      "rust-cross-root-pr12",
      "rust-tauri-darwin-pr12",
    ],
  );
  assert.ok(
    rustPr12.every(({ graphSelection }) => graphSelection.requiredLabels.includes("lang:rust")),
  );
  const cFfi = ARTIFACT_REPRODUCIBILITY_MATRIX.find(({ id }) => id === "rust-c-ffi-pr12")!;
  assert.equal(cFfi.graphSelection.target, "//projects/libs/repro-rust-c-ffi:repro-rust-c-ffi-c");
  assert.equal(cFfi.graphSelection.outputRole, "c-ffi");
  const cxxBridge = ARTIFACT_REPRODUCIBILITY_MATRIX.find(
    ({ id }) => id === "rust-cxx-bridge-pr12",
  )!;
  assert.equal(cxxBridge.graphSelection.target, "//projects/libs/repro-rust-cxx:repro-rust-cxx");
  assert.notEqual(cFfi.graphSelection.target, cxxBridge.graphSelection.target);
  const tauri = ARTIFACT_REPRODUCIBILITY_MATRIX.find(({ id }) => id === "rust-tauri-darwin-pr12")!;
  assert.deepEqual(tauri.systems, ["aarch64-darwin"]);
  assert.deepEqual(tauri.systemEvidence, {
    nativeExecution: [],
    failClosedUntilExternalEvidence: ["aarch64-darwin"],
  });
  assert.deepEqual(tauri.coverage.routeCapabilities, ["base", "mixed", "desktop"]);
  assert.deepEqual(tauri.languageProofs, [
    {
      target: "//projects/apps/repro-rust-tauri:frontend_raw",
      ruleTypes: ["genrule"],
      requiredLabels: ["lang:node", "kind:app"],
    },
    {
      target: "//projects/apps/repro-rust-tauri:frontend",
      ruleTypes: ["genrule"],
      requiredLabels: ["lang:node", "kind:app", "webapp:static"],
    },
    {
      target: "//projects/apps/repro-rust-tauri:frontend_wasm",
      ruleTypes: ["rust_nix_build"],
      requiredLabels: ["lang:rust", "kind:wasm"],
    },
    {
      target: "//projects/apps/repro-rust-tauri:repro-rust-tauri-sidecar",
      ruleTypes: ["cpp_nix_build"],
      requiredLabels: ["lang:cpp", "kind:bin", "sidecar:reviewed"],
    },
  ]);
  const rustPyodide = ARTIFACT_REPRODUCIBILITY_MATRIX.find(
    ({ id }) => id === "rust-pyodide-extension-pr14",
  )!;
  assert.equal(
    rustPyodide.graphSelection.target,
    "//projects/apps/repro-rust-pyodide:repro-rust-pyodide",
  );
  assert.deepEqual(rustPyodide.graphSelection.ruleTypes, ["python_nix_wasm_build"]);
  assert.deepEqual(rustPyodide.coverage.routeCapabilities, ["wasm", "addon", "mixed"]);
  assert.deepEqual(rustPyodide.languageProofs, [
    {
      target: "//projects/apps/repro-rust-pyodide:repro-rust-pyodide-ext",
      ruleTypes: ["rust_nix_build"],
      requiredLabels: ["lang:rust", "kind:pyext_wasm", "backend:pyodide"],
    },
  ]);
  const mixedGoTargets = await fs.readFile(
    viberootsSourcePath(
      "build-tools/tools/scaffolding/templates/ts/go-cpp-lib/libs/{{ name }}-go/TARGETS.jinja",
    ),
    "utf8",
  );
  const mixedNodeTargets = await fs.readFile(
    viberootsSourcePath(
      "build-tools/tools/scaffolding/templates/ts/go-cpp-lib/libs/{{ name }}-ts/TARGETS.jinja",
    ),
    "utf8",
  );
  assert.match(mixedGoTargets, /name = "carchive"/);
  assert.match(mixedGoTargets, /"lang:go"/);
  assert.match(mixedNodeTargets, /name = "\{\{ name \}\}_ts_pkg"/);
  assert.match(
    mixedNodeTargets,
    /deps = \["\/\/projects\/libs\/\{\{ name \}\}-native:napi_addon"\]/,
  );
  assert.match(
    mixedNodeTargets,
    /\$\(location \/\/projects\/libs\/\{\{ name \}\}-native:napi_addon\)/,
  );
  assert.match(mixedNodeTargets, /\$VBR_NODE_BIN build\.mjs src\/node\/index\.ts/);
  assert.doesNotMatch(mixedNodeTargets, /build\.stamp|echo ok/);
});

test("matrix binding rejects mismatched families and unsupported systems", () => {
  assert.doesNotThrow(() =>
    assertReproducibilityMatrixBinding({
      matrixId: "go-lib",
      artifactFamily: "go",
      system: "aarch64-darwin",
    }),
  );
  assert.throws(
    () =>
      assertReproducibilityMatrixBinding({
        matrixId: "go-lib",
        artifactFamily: "node",
        system: "aarch64-darwin",
      }),
    /requires go artifacts/,
  );
  assert.throws(
    () =>
      assertReproducibilityMatrixBinding({
        matrixId: "go-lib",
        artifactFamily: "go",
        system: "riscv64-linux",
      }),
    /does not cover Nix system/,
  );
});
