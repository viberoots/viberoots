import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveArtifactReproducibilityMatrixBindingFromValues } from "../../ci/artifact-reproducibility-matrix-binding";

const bundleRoot = `/nix/store/${"a".repeat(32)}-evaluation-bundle`;
const target = "//projects/libs/repro-go:repro-go";
const contractedNode = {
  name: target,
  rule_type: "go_nix_build",
  labels: ["lang:go", "kind:lib"],
};

test("matrix binding derives the only target and fixed graph-selected flake attribute", () => {
  const binding = resolveArtifactReproducibilityMatrixBindingFromValues({
    matrixId: "go-lib",
    evaluationBundleRoot: bundleRoot,
    graph: { $schema: "graph-v1", nodes: [contractedNode] },
    selection: { attr: "graph-generator-selected", target },
    flakeSubdir: ".viberoots/workspace",
  });
  assert.equal(binding.target, target);
  assert.equal(binding.attr, "graph-generator-selected");
  assert.equal(binding.outputRole, "library");
  assert.deepEqual(binding.languageProofs, []);
  assert.equal(
    binding.flakeRef,
    `path:${bundleRoot}?dir=source/.viberoots/workspace#graph-generator-selected`,
  );
  assert.match(binding.bindingDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("matrix binding rejects arbitrary selection and ambiguous graph authority", () => {
  const base = {
    matrixId: "go-lib",
    evaluationBundleRoot: bundleRoot,
    graph: { nodes: [contractedNode] },
    flakeSubdir: ".",
  };
  assert.throws(
    () =>
      resolveArtifactReproducibilityMatrixBindingFromValues({
        ...base,
        selection: { attr: "graph-generator-selected", target: "//other:target" },
      }),
    /must bind/,
  );
  assert.throws(
    () =>
      resolveArtifactReproducibilityMatrixBindingFromValues({
        ...base,
        graph: { nodes: [contractedNode, contractedNode] },
        selection: { attr: "graph-generator-selected", target },
      }),
    /exactly one graph-contracted target; found 2/,
  );
  assert.throws(
    () =>
      resolveArtifactReproducibilityMatrixBindingFromValues({
        ...base,
        graph: { nodes: [{ ...contractedNode, rule_type: "genrule" }] },
        selection: { attr: "graph-generator-selected", target },
      }),
    /found 0/,
  );
  assert.throws(
    () =>
      resolveArtifactReproducibilityMatrixBindingFromValues({
        ...base,
        graph: { nodes: [{ ...contractedNode, labels: ["kind:lib"] }] },
        selection: { attr: "graph-generator-selected", target },
      }),
    /found 0/,
  );
});

test("mixed matrix binding requires every graph-proven language target", () => {
  const mixedTarget = "//projects/libs/repro-mixed-ts:repro-mixed_ts_pkg";
  const nativeTarget = "//projects/libs/repro-mixed-native:napi_addon";
  const goTarget = "//projects/libs/repro-mixed-go:carchive";
  const graph = {
    nodes: [
      {
        name: mixedTarget,
        rule_type: "genrule",
        labels: ["lang:node"],
        deps: [nativeTarget],
      },
      {
        name: nativeTarget,
        rule_type: "cpp_nix_build",
        labels: ["lang:cpp", "kind:addon"],
        deps: [goTarget],
      },
      {
        name: goTarget,
        rule_type: "go_nix_build",
        labels: ["lang:go", "kind:carchive"],
      },
    ],
  };
  const options = {
    matrixId: "mixed-artifact",
    evaluationBundleRoot: bundleRoot,
    graph,
    selection: { attr: "graph-generator-selected", target: mixedTarget },
    flakeSubdir: ".",
  };
  assert.doesNotThrow(() => resolveArtifactReproducibilityMatrixBindingFromValues(options));
  const binding = resolveArtifactReproducibilityMatrixBindingFromValues(options);
  assert.equal(binding.languageProofs.length, 2);
  assert.deepEqual(binding.nodeArtifact?.outputPaths, [
    "dist/node/index.mjs",
    "dist/native/napi_addon.node",
  ]);
  assert.equal(binding.nodeArtifact?.nativeClosureTarget, nativeTarget);
  assert.throws(
    () =>
      resolveArtifactReproducibilityMatrixBindingFromValues({
        ...options,
        graph: { nodes: graph.nodes.filter(({ rule_type }) => rule_type !== "go_nix_build") },
      }),
    /dependency is absent from graph.*repro-mixed-go:carchive/,
  );
});

test("mixed matrix binding rejects a detached language proof node", () => {
  const mixedTarget = "//projects/libs/repro-mixed-ts:repro-mixed_ts_pkg";
  const nativeTarget = "//projects/libs/repro-mixed-native:napi_addon";
  const goTarget = "//projects/libs/repro-mixed-go:carchive";
  assert.throws(
    () =>
      resolveArtifactReproducibilityMatrixBindingFromValues({
        matrixId: "mixed-artifact",
        evaluationBundleRoot: bundleRoot,
        graph: {
          nodes: [
            { name: mixedTarget, rule_type: "genrule", labels: ["lang:node"], deps: [] },
            {
              name: nativeTarget,
              rule_type: "cpp_nix_build",
              labels: ["lang:cpp", "kind:addon"],
              deps: [goTarget],
            },
            {
              name: goTarget,
              rule_type: "go_nix_build",
              labels: ["lang:go", "kind:carchive"],
            },
          ],
        },
        selection: { attr: "graph-generator-selected", target: mixedTarget },
        flakeSubdir: ".",
      }),
    /language proof .*repro-mixed-native:napi_addon.*reachable dependency; found 0/,
  );
});
