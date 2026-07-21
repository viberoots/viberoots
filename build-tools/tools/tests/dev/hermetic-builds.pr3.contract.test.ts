#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { withoutEvaluationSelectors } from "../../dev/evaluation-bundle-env";

const root = path.resolve("viberoots");

async function source(relative: string): Promise<string> {
  return await fsp.readFile(path.join(root, relative), "utf8");
}

test("normal materialization has no impure argv and strips former selectors", async () => {
  const selected = await source("build-tools/tools/dev/build-selected-nix-command.ts");
  const full = await source("build-tools/tools/dev/dev-build/materialize-pure.ts");
  const filtered = await source("build-tools/tools/dev/nix-build-filtered-flake.ts");
  const runnable = await source("build-tools/tools/dev/run-runnable-graph.ts");
  assert.doesNotMatch(selected, /["']--impure["']/);
  assert.doesNotMatch(full, /args: `--impure/);
  assert.doesNotMatch(filtered, /["']--impure["']/);
  assert.doesNotMatch(runnable, /["']--impure["']/);
  assert.match(filtered, /withoutEvaluationSelectors\(process\.env\)/);
  assert.match(runnable, /withoutEvaluationSelectors\(process\.env\)/);
  const env = withoutEvaluationSelectors({
    BUCK_GRAPH_JSON: "/host/graph.json",
    BUCK_TARGET: "//host:target",
    NIX_GO_DEV_OVERRIDE_JSON: "poison",
    ROOT_GOMOD2NIX_TOML: "/host/gomod2nix.toml",
    SAFE_TRANSPORT: "kept",
    WORKSPACE_ROOT: "/host/workspace",
  });
  assert.deepEqual(env, { SAFE_TRANSPORT: "kept" });
});

test("bundle fields are the normal graph selector authority", async () => {
  const bundle = await source("build-tools/tools/dev/evaluation-bundle.ts");
  const context = await source("build-tools/tools/nix/flake/evaluation-bundle.nix");
  const systemContext = await source("build-tools/tools/nix/flake/per-system-context.nix");
  const graph = await source("build-tools/tools/nix/flake/packages/graph.nix");
  const planner = await source("build-tools/tools/nix/graph-generator.nix");
  const langs = await source("build-tools/tools/nix/planner/langs.nix");
  const goWasm = await source("build-tools/tools/nix/planner/go-wasm.nix");
  assert.match(bundle, /\?dir=\$\{path\.posix\.join\("source", subdir\)\}/);
  assert.match(context, /selection\.json/);
  assert.match(context, /dependency-inputs\.json/);
  assert.match(context, /canonicalBundleCandidate/);
  assert.ok(
    context.indexOf(
      "if !canonicalBundleCandidate || !builtins.pathExists schemaPathString then null",
    ) < context.indexOf("builtins.toPath bundleRootString"),
    "ordinary store sources must be rejected before constructing bundle child paths",
  );
  assert.match(graph, /evaluationBundle\.graphPath/);
  assert.match(graph, /evaluationBundle\.selection\.target/);
  assert.match(graph, /evaluationBundle\.rootModulesTomlPath/);
  assert.match(planner, /evaluationBundle\.languageOverrides/);
  assert.match(langs, /onlyCpp = ctx\.onlyCpp or false/);
  assert.doesNotMatch(langs, /getEnv "PLANNER_ONLY_CPP"/);
  assert.match(goWasm, /backend = wasmBackend/);
  assert.doesNotMatch(goWasm, /getEnv "WEB_WASM_BACKEND"/);
  assert.match(context, /bundleRoot \+ "\/\$\{relative\}"/);
  assert.match(systemContext, /repoRoot \+ "\/projects\/config\/node-modules\.hashes\.json"/);
  assert.match(systemContext, /allowLiveHashMap = evaluationBundle == null/);
});

test("Python build templates use explicit immutable source roots", async () => {
  const inputs = await source("build-tools/tools/nix/uv2nix-inputs.nix");
  const env = await source("build-tools/tools/nix/uv2nix-env.nix");
  const python = await source("build-tools/tools/nix/templates/python.nix");
  const wasm = await source("build-tools/tools/nix/templates/python/wasm.nix");
  const wasmSite = await source("build-tools/tools/nix/templates/python/wasm-site.nix");
  const uv2nix = await source("third_party/uv2nix/flake.nix");
  for (const text of [inputs, env, python, wasm, wasmSite]) {
    assert.doesNotMatch(text, /builtins\.getEnv "(?:WORKSPACE_ROOT|BUCK_TEST_SRC)"/);
  }
  assert.match(inputs, /if wsRootOk then wsRoot/);
  assert.match(inputs, /explicit wsRoot is required/);
  assert.match(env, /originRoot = inputs\.originRoot/);
  assert.match(python, /wsRoot = builtins\.toString srcRoot/);
  assert.match(wasm, /wsRoot = builtins\.toString srcRoot/);
  assert.match(wasmSite, /wsRoot = builtins\.toString srcRoot/);
  assert.match(uv2nix, /\$\{pkgs\.python3 or pkgs\.python311\}\/bin\/python/);
  assert.doesNotMatch(uv2nix, /builtins\.currentSystem/);
});

test("generated workspace flakes use relative source and local development stays pure", async () => {
  const bootstrap = await source("build-tools/tools/lib/consumer-bootstrap.ts");
  const untracked = await source("build-tools/tools/dev/dev-build/untracked.ts");
  assert.match(bootstrap, /workspaceSrc = \.\.\/\.\.;/);
  assert.doesNotMatch(bootstrap, /root = builtins\.getEnv "WORKSPACE_ROOT"/);
  assert.match(untracked, /return \{ impure: false, classification: "local-development" \}/);
  assert.doesNotMatch(untracked, /Falling back to --impure/);
});
