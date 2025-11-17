#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp Node-API addon builds a .node artifact (nix template smoke)", async () => {
  await runInTemp("cpp-node-addon", async (tmp, $) => {
    // Create minimal Node-API addon sources
    await $({ cwd: tmp })`bash -lc 'mkdir -p libs/demo-native/src'`;
    await $({
      cwd: tmp,
    })`bash -lc 'cat > libs/demo-native/src/binding.cc <<"EOF"
#include <node_api.h>

static napi_value Answer(napi_env env, napi_callback_info info) {
  napi_value num;
  napi_create_int32(env, 42, &num);
  return num;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "answer", NAPI_AUTO_LENGTH, Answer, NULL, &fn);
  napi_set_named_property(env, exports, "answer", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init);
EOF'`;

    // Write a tiny nix file that invokes the new template
    await $({
      cwd: tmp,
    })`bash -lc 'cat > addon.nix <<"EOF"
{ pkgs ? (import ((builtins.getFlake (toString ./.)).inputs.nixpkgs) { system = builtins.currentSystem; }) }:
let
  T = import ./tools/nix/templates/cpp-node-addon.nix { inherit pkgs; };
in
T.cppNodeAddon {
  name = "demo";
  addonName = "demo_addon";
  srcRoot = ./libs/demo-native;
  subdir = ".";
  std = "c++17";
  nixCxxAttrs = [ ];
}
EOF'`;

    // Build and assert the .node artifact exists; also sanity check with otool/ldd
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`bash -lc 'nix build -f ./addon.nix --print-out-paths'`;
    if (build.exitCode !== 0) {
      console.error(build.stdout + "\n" + build.stderr);
      throw new Error("nix build failed (cpp-node-addon)");
    }
    const out = String(build.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop()!;
    await $({ cwd: tmp })`bash -lc 'test -f "${out}/lib/demo_addon.node"'`;

    // otool -L (Darwin) or ldd (Linux) should succeed; no strict assertions on content
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`bash -lc 'if [ "$(uname -s)" = "Darwin" ]; then otool -L "${out}/lib/demo_addon.node"; else ldd "${out}/lib/demo_addon.node" || true; fi'`;
    if (probe.exitCode !== 0) {
      console.error(probe.stdout + "\n" + probe.stderr);
      throw new Error("linkage probe failed");
    }
  });
});
