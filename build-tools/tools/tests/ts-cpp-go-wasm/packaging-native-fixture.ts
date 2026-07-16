import fs from "fs-extra";
import path from "node:path";
import { withGoModuleInputFingerprint } from "../../dev/install/go-consistency";

export async function writePackagingNativeFixture(tmp: string): Promise<void> {
  const coreDir = path.join(tmp, "projects", "libs", "math-core");
  await fs.outputFile(
    path.join(coreDir, "include", "addon.h"),
    `#ifndef MATH_CORE_ADDON_H
#define MATH_CORE_ADDON_H
#ifdef __cplusplus
extern "C" {
#endif
int add(int a, int b);
#ifdef __cplusplus
}
#endif
#endif
`,
  );
  await fs.outputFile(
    path.join(coreDir, "src", "cwrapper", "addon.c"),
    `#include "../../include/addon.h"
int add(int a, int b) { return a + b; }
`,
  );
  await fs.outputFile(
    path.join(coreDir, "TARGETS"),
    `load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_wasm_static_lib")

nix_cpp_wasm_static_lib(
    name = "core_wasm",
    srcs = ["src/cwrapper/addon.c"],
    headers = ["include/addon.h"],
    labels = ["lang:cpp", "kind:lib"],
    visibility = ["PUBLIC"],
)
`,
  );

  const apiDir = path.join(tmp, "projects", "libs", "math-api");
  await fs.mkdirp(apiDir);
  await fs.writeFile(path.join(apiDir, "go.mod"), "module example.com/math/api\n\ngo 1.22.0\n");
  await fs.writeFile(path.join(apiDir, "go.sum"), "");
  await fs.writeFile(
    path.join(apiDir, "gomod2nix.toml"),
    await withGoModuleInputFingerprint(
      apiDir,
      [
        "schema = 3",
        "mod = {}",
        "replace = {}",
        "prune = { go-tests = true, unused-packages = true }",
        "",
      ].join("\n"),
    ),
  );
  await fs.writeFile(
    path.join(apiDir, "main.go"),
    `package main

//export add
func add(a int32, b int32) int32 {
  return a + b
}

func main() {}
`,
  );
  await fs.writeFile(
    path.join(apiDir, "TARGETS"),
    `load("@viberoots//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib", "nix_go_carchive")

nix_go_tiny_wasm_lib(
    name = "wasm",
    srcs = ["main.go"],
    deps = ["//projects/libs/math-core:core_wasm"],
    labels = ["lang:go", "kind:wasm"],
    visibility = ["PUBLIC"],
)

nix_go_carchive(
    name = "carchive",
    srcs = ["main.go"],
    labels = ["lang:go", "kind:carchive"],
    visibility = ["PUBLIC"],
)
`,
  );

  const nativeDir = path.join(tmp, "projects", "libs", "math-native");
  await fs.mkdirp(path.join(nativeDir, "src"));
  await fs.writeFile(
    path.join(nativeDir, "src", "binding.cc"),
    `#include <node_api.h>
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
`,
  );
  await fs.writeFile(
    path.join(nativeDir, "TARGETS"),
    `load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_node_addon")

nix_cpp_node_addon(
    name = "napi_addon",
    srcs = ["src/binding.cc"],
    deps = [
        "//projects/libs/math-api:carchive",
        "//projects/libs/math-core:core_wasm",
    ],
    labels = ["lang:cpp", "kind:addon"],
    visibility = ["PUBLIC"],
)
`,
  );
}
