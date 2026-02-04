#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

test("nix_cpp_node_addon builds a .node artifact via Buck/Nix", async () => {
  await runInTemp("cpp-node-addon-macro", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    // Enable C++ in the temp workspace so the planner picks it up
    await $`bash --noprofile --norc -c 'mkdir -p build-tools/tools/nix && printf "%s\n" "{\"enabled\":[\"cpp\"]}" > build-tools/tools/nix/langs.json'`;

    // Create minimal Node-API addon sources
    await $`bash --noprofile --norc -c 'mkdir -p libs/demo-native/src'`;
    await $`bash --noprofile --norc -c 'cat > libs/demo-native/src/binding.cc <<"EOF"
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

    // TARGETS using the new macro
    await $`bash --noprofile --norc -c 'cat > libs/demo-native/TARGETS <<"EOF"
load("//cpp:defs.bzl", "nix_cpp_node_addon")

nix_cpp_node_addon(
    name = "napi_addon",
    srcs = ["src/binding.cc"],
)
EOF'`;

    // Build once via buck to exercise the rule wrapper
    await $`buck2 --isolation-dir cpp_addon_macro build //libs/demo-native:napi_addon`;

    // Assert the .node artifact exists under buck-out (sanitized name from sanitizer)
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`bash --noprofile --norc -c 'find buck-out -type f -name "libs-demo-native-napi_addon.node" -print -quit'`;
    const found = String(probe.stdout || "").trim();
    if (!found) {
      throw new Error("addon .node artifact not found under buck-out");
    }
  });
});
