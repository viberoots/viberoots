#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

function parseOutPath(stdout: unknown): string {
  return String(stdout || "")
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()!;
}

test("cpp addon follows transitive link_deps with link_closure=transitive (build + load)", async () => {
  await runInTemp("cpp-addon-link-closure-transitive", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "tools", "nix", "langs.json"),
      JSON.stringify({ enabled: ["cpp"] }, null, 2) + "\n",
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "support", "include", "support.h"),
      ["#pragma once", "int support_answer();", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "support", "src", "support.cpp"),
      ['#include "../include/support.h"', "int support_answer() { return 5; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "support", "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_headers", "nix_cpp_library")',
        "",
        "nix_cpp_headers(",
        '  name = "headers",',
        '  srcs = ["include/support.h"],',
        '  labels = ["lang:cpp", "kind:headers"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
        "nix_cpp_library(",
        '  name = "support",',
        '  srcs = ["src/support.cpp", "include/support.h"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "core", "include", "core.h"),
      ["#pragma once", "int core_answer();", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "core", "src", "core.cpp"),
      [
        '#include "../include/core.h"',
        "#include <support.h>",
        "int core_answer() {",
        "  return support_answer() + 6;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "core", "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "core",',
        '  srcs = ["src/core.cpp", "include/core.h"],',
        '  link_deps = ["//libs/support:support"],',
        '  header_deps = ["//libs/support:headers"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "addon-native", "src", "binding.cc"),
      [
        "#include <node_api.h>",
        "#include <core.h>",
        "",
        "static napi_value Answer(napi_env env, napi_callback_info info) {",
        "  napi_value num;",
        "  napi_create_int32(env, core_answer(), &num);",
        "  return num;",
        "}",
        "",
        "static napi_value Init(napi_env env, napi_value exports) {",
        "  napi_value fn;",
        '  napi_create_function(env, "answer", NAPI_AUTO_LENGTH, Answer, NULL, &fn);',
        '  napi_set_named_property(env, exports, "answer", fn);',
        "  return exports;",
        "}",
        "",
        "NAPI_MODULE(NODE_GYP_MODULE_NAME, Init);",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "addon-native", "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_node_addon")',
        "",
        "nix_cpp_node_addon(",
        '  name = "addon",',
        '  srcs = ["src/binding.cc"],',
        '  link_deps = ["//libs/core:core"],',
        '  link_closure = "transitive",',
        '  labels = ["lang:cpp", "kind:addon"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir cpp_addon_link_closure cquery "deps(//libs/addon-native:addon)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return;

    await $({ cwd: tmp })`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, BUCK_TARGET: "//libs/addon-native:addon" },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    assert.equal(build.exitCode, 0, String(build.stderr || build.stdout));

    const outPath = parseOutPath(build.stdout);
    const libDir = path.join(outPath, "lib");
    const entries = (await fs.readdir(libDir).catch(() => [])) as string[];
    const nodeFile = entries.find((e) => e.endsWith(".node"));
    assert.ok(nodeFile, `no .node artifact found under ${libDir}`);

    const script = [
      "const p = process.argv[1];",
      "const a = require(p);",
      "if (!a || typeof a.answer !== 'function') process.exit(2);",
      "const v = a.answer();",
      "if (v !== 11) { console.error('bad answer', v); process.exit(3); }",
      "console.log('ok');",
    ].join("");
    const run = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`node -e ${script} ${path.join(libDir, nodeFile)}`;
    assert.equal(run.exitCode, 0, String(run.stderr || run.stdout));
    assert.match(String(run.stdout || ""), /^ok\b/m);
  });
});
