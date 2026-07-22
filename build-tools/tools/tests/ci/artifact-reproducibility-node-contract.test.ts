import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertReproducibilityNodeArtifact,
  reproducibilityNodeArtifact,
} from "../../lib/artifact-reproducibility-node-contract";

const bundle = `/nix/store/${"a".repeat(32)}-bundle/source`;
const output = `/nix/store/${"b".repeat(32)}-node-output`;
const derivation = `/nix/store/${"c".repeat(32)}-node-output.drv`;
const nodeInput = `/nix/store/${"d".repeat(32)}-nodejs-22.17.0.drv`;
const nativeName = "projects-libs-demo-native-napi_addon";
const nativeInput = `/nix/store/${"e".repeat(32)}-cppnode-addon-${nativeName}-0.1.0.drv`;
const nativeOutput = `/nix/store/${"f".repeat(32)}-cppnode-addon-${nativeName}-0.1.0`;

function derivationEvidence(inputs: string[], selected = derivation): string {
  return JSON.stringify({
    [selected]: {
      inputDrvs: Object.fromEntries(inputs.map((input) => [input, { outputs: ["out"] }])),
      outputs: { out: { path: nativeOutput } },
    },
  });
}

test("Node artifact proof binds immutable source transformation and output paths", async () => {
  const calls: string[][] = [];
  const contract = reproducibilityNodeArtifact(
    "esm-with-native-addon",
    "projects/libs/demo/src/node/index.ts",
    ["dist/node/index.mjs", "dist/native/napi_addon.node"],
    "//projects/libs/demo-native:napi_addon",
  );
  await assertReproducibilityNodeArtifact({
    contract,
    evaluationBundleSourceRoot: bundle,
    outputPath: output,
    readSource: async (file) => {
      assert.equal(file, `${bundle}/${contract.sourcePath}`);
      return "immutable TypeScript";
    },
    transformSource: () => "deterministic JavaScript\n",
    runNix: async (args) => {
      calls.push(args);
      if (args[0] === "path-info") return { stdout: `${derivation}\n` };
      if (args[0] === "derivation") {
        return {
          stdout: derivationEvidence(
            [nodeInput, nativeInput],
            args.at(-1) === nativeInput ? nativeInput : derivation,
          ),
        };
      }
      if (args[0] === "hash") return { stdout: "sha256-native\n" };
      return {
        stdout: "deterministic JavaScript\n",
      };
    },
  });
  assert.deepEqual(calls, [
    ["store", "cat", `${output}/dist/node/index.mjs`],
    ["path-info", "--derivation", output],
    ["derivation", "show", derivation],
    ["derivation", "show", nativeInput],
    ["hash", "file", "--type", "sha256", `${output}/dist/native/napi_addon.node`],
    ["hash", "file", "--type", "sha256", `${nativeOutput}/lib/${nativeName}.node`],
  ]);
});

test("Node artifact proof rejects source drift and an omitted native output", async () => {
  const contract = reproducibilityNodeArtifact("esm", "src/index.ts", ["dist/index.mjs"]);
  const base = {
    contract,
    evaluationBundleSourceRoot: bundle,
    outputPath: output,
    readSource: async () => "source",
    transformSource: () => "expected\n",
  };
  await assert.rejects(
    assertReproducibilityNodeArtifact({ ...base, runNix: async () => ({ stdout: "wrong\n" }) }),
    /does not match its immutable source contract/,
  );
  await assert.rejects(
    assertReproducibilityNodeArtifact({
      ...base,
      contract: reproducibilityNodeArtifact(
        "esm-with-native-addon",
        "src/index.ts",
        ["dist/index.mjs", "dist/addon.node"],
        "//projects/libs/demo-native:napi_addon",
      ),
      runNix: async (args) => {
        if (args[0] === "path-info") return { stdout: derivation };
        if (args[0] === "derivation") {
          return {
            stdout: derivationEvidence(
              [nodeInput, nativeInput],
              args.at(-1) === nativeInput ? nativeInput : derivation,
            ),
          };
        }
        if (args[0] === "hash") {
          return { stdout: args.at(-1)?.startsWith(output) ? "packaged" : "dependency" };
        }
        return { stdout: "expected\n" };
      },
    }),
    /does not match its native addon input/,
  );
});

test("Node artifact proof rejects missing toolchain and native derivation authorities", async () => {
  const run = async (inputs: string[], mixed: boolean) =>
    await assertReproducibilityNodeArtifact({
      contract: reproducibilityNodeArtifact(
        mixed ? "esm-with-native-addon" : "esm",
        "src/index.ts",
        mixed ? ["dist/index.mjs", "dist/addon.node"] : ["dist/index.mjs"],
        mixed ? "//native:addon" : undefined,
      ),
      evaluationBundleSourceRoot: bundle,
      outputPath: output,
      readSource: async () => "source",
      transformSource: () => "expected\n",
      runNix: async (args) => {
        if (args[0] === "path-info") return { stdout: derivation };
        if (args[0] === "derivation") return { stdout: derivationEvidence(inputs) };
        return { stdout: "expected\n" };
      },
    });
  await assert.rejects(run([], false), /omitted its pinned Node 22 toolchain/);
  await assert.rejects(run([nodeInput], true), /omitted its native addon input/);
});
