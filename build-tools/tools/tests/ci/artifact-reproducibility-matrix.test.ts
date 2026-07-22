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
    ["cpp", "go", "mixed", "node", "python", "wasm"],
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

test("every matrix recipe binds the target emitted by its actual scaffold template", async () => {
  const contracts = [
    ["go-lib", "go/lib/TARGETS.jinja", "projects/libs/repro-go", "repro-go"],
    ["node-artifact", "ts/lib/TARGETS.jinja", "projects/libs/repro-node", "repro-node"],
    ["python-artifact", "python/app/TARGETS.jinja", "projects/apps/repro-python", "repro-python"],
    ["cpp-lib", "cpp/lib/TARGETS.jinja", "projects/libs/repro-cpp", "repro-cpp"],
    ["wasm-artifact", "python/wasm-lib/TARGETS.jinja", "projects/libs/repro-wasm", "repro-wasm"],
    [
      "mixed-artifact",
      "ts/go-cpp-lib/libs/{{ name }}-ts/TARGETS.jinja",
      "projects",
      "{{ name }}_ts_pkg",
    ],
  ] as const;
  for (const [id, template, destination, targetName] of contracts) {
    const entry = ARTIFACT_REPRODUCIBILITY_MATRIX.find((candidate) => candidate.id === id)!;
    assert.equal(entry.scaffoldRecipe.destination, destination);
    const expectedTargetPath =
      id === "mixed-artifact"
        ? `//${destination}/libs/${entry.scaffoldRecipe.name}-ts:${entry.scaffoldRecipe.name}_ts_pkg`
        : `//${destination}:${targetName}`;
    assert.equal(entry.graphSelection.target, expectedTargetPath);
    const targets = await fs.readFile(
      viberootsSourcePath(`build-tools/tools/scaffolding/templates/${template}`),
      "utf8",
    );
    const templateTargetName = id === "mixed-artifact" ? targetName : "{{ name }}";
    assert.ok(targets.includes(`name = ${JSON.stringify(templateTargetName)}`));
  }
  const cppTargets = await fs.readFile(
    viberootsSourcePath("build-tools/tools/scaffolding/templates/cpp/lib/TARGETS.jinja"),
    "utf8",
  );
  assert.equal(cppTargets.match(/nix_cpp_library\(/gu)?.length, 1);
  assert.equal(cppTargets.match(/nix_cpp_test\(/gu)?.length, 1);
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
