#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

const cases = [
  ["emscripten", '{ emscripten = "/bad-emscripten"; }'],
  ["CPython", '{ cpythonMinor = "0.0"; }'],
  ["extension suffix", '{ extensionSuffix = "/bad-suffix"; }'],
  ["exception", '{ exceptionPolicy = "wasm-exception"; }'],
  ["pthread", "{ targetFeatures = { pthreads = true; atomics = false; }; }"],
  ["target-feature", "{ targetFeatures = { pthreads = false; atomics = true; }; }"],
  ["PyO3", '{ pyo3Cross = { enabled = false; implementation = "CPython"; version = "0.0"; }; }'],
] as const;

async function evalAbi(tmp: string, $: any, override: string) {
  const flake = `path:${await workspaceFlakeRef(tmp)}`;
  const abiPath = path.join(
    tmp,
    "viberoots/build-tools/tools/nix/templates/python/pyemscripten-abi.nix",
  );
  const expr = `
let
  f = builtins.getFlake ${JSON.stringify(flake)};
  pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  lib = pkgs.lib;
  Abi = import ${JSON.stringify(abiPath)} { inherit pkgs lib; };
in Abi.validateConfig (Abi.config // ${override})
`;
  return await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`nix eval --impure --expr ${expr}`;
}

test("PyEmscripten ABI authority rejects mismatches before builds", async () => {
  await runInTemp("rust-pyodide-abi-negative", async (tmp, $) => {
    const ok = await evalAbi(tmp, $, "{}");
    assert.equal(ok.exitCode, 0, String(ok.stderr || ""));
    for (const [name, override] of cases) {
      const bad = await evalAbi(tmp, $, override);
      assert.notEqual(bad.exitCode, 0, `${name} mismatch unexpectedly passed`);
      assert.match(`${bad.stdout}\n${bad.stderr}`, /PyEmscripten ABI mismatch/);
    }
  });
});
