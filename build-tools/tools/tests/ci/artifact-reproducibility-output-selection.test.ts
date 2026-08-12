import assert from "node:assert/strict";
import { test } from "node:test";
import { buildArtifactOutputPair } from "../../ci/artifact-reproducibility-output-selection";

const storePath = (character: string, name: string) => `/nix/store/${character.repeat(32)}-${name}`;

test("Rust Wasm selects its declared provenance output", async () => {
  const calls: string[][] = [];
  const pair = await buildArtifactOutputPair(
    "path:/nix/store/source#selected",
    { kind: "matrix", matrixId: "rust-wasm-pr12", artifactFamily: "rust" },
    async (args) => {
      calls.push(args);
      return {
        stdout: args.at(-1)!.endsWith("^provenance")
          ? storePath("b", "provenance")
          : storePath("a", "runtime"),
      };
    },
  );

  assert.deepEqual(pair, {
    outputPath: storePath("a", "runtime"),
    provenanceOutputPath: storePath("b", "provenance"),
  });
  assert.deepEqual(
    calls.map((args) => args.at(-1)),
    ["path:/nix/store/source#selected^out", "path:/nix/store/source#selected^provenance"],
  );
});

test("native Rust uses its runtime output as provenance", async () => {
  const calls: string[][] = [];
  const pair = await buildArtifactOutputPair(
    "path:/nix/store/source#selected",
    { kind: "matrix", matrixId: "rust-pr5", artifactFamily: "rust" },
    async (args) => {
      calls.push(args);
      return { stdout: storePath("a", "runtime") };
    },
  );

  assert.deepEqual(pair, {
    outputPath: storePath("a", "runtime"),
    provenanceOutputPath: storePath("a", "runtime"),
  });
  assert.equal(calls.length, 1);
});
