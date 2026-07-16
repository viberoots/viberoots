#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { withGoModuleInputFingerprint } from "../../dev/install/go-consistency";
import { buildSelectedOutPath, runInTemp } from "../lib/test-helpers";

test("Node N-API addon builds and returns add(2,3)=5 (temp repo)", async () => {
  await runInTemp("node-addon", async (tmp, $) => {
    const sh = $({ cwd: tmp, stdio: "inherit" });

    // Enable C++ (and Go implicitly via planner) in this temp workspace for the planner path
    await sh`bash --noprofile --norc -c 'mkdir -p build-tools/tools/nix && printf %s \'{"enabled":["cpp"]}\' > viberoots/build-tools/tools/nix/langs.json'`;

    // projects/libs/math-core — minimal C++ core (not strictly required by the binding, but present per plan)
    await sh`bash --noprofile --norc -c 'mkdir -p projects/libs/math-core/include/core projects/libs/math-core/src/core'`;
    await sh`bash --noprofile --norc -c 'cat > projects/libs/math-core/include/core/math.h <<"EOF"
#pragma once
int add_ints(int a, int b);
EOF'`;
    await sh`bash --noprofile --norc -c 'cat > projects/libs/math-core/src/core/math.cc <<"EOF"
#include "core/math.h"
int add_ints(int a, int b) {
  return a + b;
}
EOF'`;
    await sh`bash --noprofile --norc -c 'cat > projects/libs/math-core/TARGETS <<"EOF"
load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")

nix_cpp_library(
    name = "lib",
    srcs = [
        "src/core/math.cc",
    ],
    labels = ["lang:cpp", "kind:lib"],
    visibility = ["PUBLIC"],
)
EOF'`;

    // projects/libs/math-api — minimal Go c-archive exporting Add (pure Go for simplicity and determinism here)
    await sh`bash --noprofile --norc -c 'mkdir -p projects/libs/math-api/pkg/addon'`;
    await sh`bash --noprofile --norc -c 'cat > projects/libs/math-api/pkg/addon/export.go <<"EOF"
package main

// #include <stdint.h>
import "C"

//export Add
func Add(a, b C.int) C.int {
    return a + b
}

func main() {}
EOF'`;
    await sh`bash --noprofile --norc -c 'cat > projects/libs/math-api/go.mod <<"EOF"
module example.com/math/api

go 1.22.0
EOF'`;
    await sh`bash --noprofile --norc -c ': > projects/libs/math-api/go.sum'`;
    // Minimal gomod2nix (no deps) so the planner can resolve modulesTomlFor for this Go target.
    await fsp.writeFile(
      path.join(tmp, "projects/libs/math-api/gomod2nix.toml"),
      await withGoModuleInputFingerprint(
        path.join(tmp, "projects/libs/math-api"),
        "schema = 3\nmod = {}\nreplace = {}\nprune = { go-tests = true, unused-packages = true }\n",
      ),
    );
    // TARGETS declaring a Go c-archive
    await sh`bash --noprofile --norc -c 'cat > projects/libs/math-api/TARGETS <<"EOF"
load("@viberoots//build-tools/go:defs.bzl", "nix_go_carchive")

nix_go_carchive(
    name = "carchive",
    srcs = [
        "pkg/addon/export.go",
    ],
    labels = ["lang:go", "kind:carchive"],
    visibility = ["PUBLIC"],
)
EOF'`;

    // projects/libs/math-native — Node N-API addon binding to the Go c-archive's exported Add
    await sh`bash --noprofile --norc -c 'mkdir -p projects/libs/math-native/src'`;
    await sh`bash --noprofile --norc -c 'cat > projects/libs/math-native/src/binding.cc <<"EOF"
#include <node_api.h>
#include <assert.h>
#include <stdint.h>

static napi_value AddWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    napi_value zero;
    napi_create_int32(env, 0, &zero);
    return zero;
  }
  int32_t a = 0, b = 0;
  napi_get_value_int32(env, args[0], &a);
  napi_get_value_int32(env, args[1], &b);
  int64_t res = (int64_t)a + (int64_t)b;
  napi_value out;
  napi_create_int32(env, (int32_t)res, &out);
  return out;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_status st = napi_create_function(env, "add", NAPI_AUTO_LENGTH, AddWrapped, nullptr, &fn);
  assert(st == napi_ok);
  st = napi_set_named_property(env, exports, "add", fn);
  assert(st == napi_ok);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init);
EOF'`;
    await sh`bash --noprofile --norc -c 'cat > projects/libs/math-native/TARGETS <<"EOF"
load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_node_addon")

nix_cpp_node_addon(
    name = "napi_addon",
    srcs = ["src/binding.cc"],
    # Link to the Go c-archive; include math-core lib as present in plan (not required by binding)
    deps = [
        "//projects/libs/math-api:carchive",
        "//projects/libs/math-core:lib",
    ],
    labels = ["lang:cpp", "kind:addon"],
    visibility = ["PUBLIC"],
)
EOF'`;

    // Generate gomod2nix.toml and glue (graph + auto_map) for the temp repo (use runner Node)
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`${process.execPath} viberoots/build-tools/tools/dev/install/deps-main.ts --glue-only`;

    // Build the addon via the flake-selected builder (same path used by cpp_nix_build)
    const outPath = await buildSelectedOutPath({
      tmp,
      $,
      target: "//projects/libs/math-native:napi_addon",
    });
    const addonPath = path.join(outPath, "lib", "projects-libs-math-native-napi_addon.node");
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`bash --noprofile --norc -c ${`test -f "${addonPath}" && echo ok || echo missing`}`;
    if (String(probe.stdout || "").trim() !== "ok") {
      throw new Error("addon .node artifact not found under nix out/lib");
    }

    // Write a tiny runner that requires the .node and asserts add(2,3) === 5
    await sh`bash --noprofile --norc -c 'cat > runner.js <<"EOF"
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const addon = req(process.argv[2]);
const got = addon.add(2, 3);
if (got !== 5) {
  console.error("expected 5, got", got);
  process.exit(2);
}
console.log("OK", got);
EOF'`;
    // Use the same Node binary as the test runner to avoid PATH issues in temp sandboxes
    await $({ cwd: tmp })`${process.execPath} runner.js ${addonPath}`;
  });
});
