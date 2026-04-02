#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs-extra";
import path from "node:path";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

function parseOutPath(stdout: unknown): string {
  return String(stdout || "")
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()!;
}

test("cpp Node-API addon links an in-repo C++ lib via link_deps (build + load)", async () => {
  await runInTemp("cpp-addon-links-repo-lib", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "build-tools", "tools", "nix", "langs.json"),
      JSON.stringify({ enabled: ["cpp"] }, null, 2) + "\n",
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "greeter", "include", "greeter.h"),
      ["#pragma once", "int greeter_answer();", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "greeter", "src", "greeter.cpp"),
      ['#include "../include/greeter.h"', "int greeter_answer() { return 123; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "greeter", "TARGETS"),
      [
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "greeter",',
        '  srcs = ["src/greeter.cpp", "include/greeter.h"],',
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
        "#include <greeter.h>",
        "",
        "static napi_value Answer(napi_env env, napi_callback_info info) {",
        "  napi_value num;",
        "  napi_create_int32(env, greeter_answer(), &num);",
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
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_node_addon")',
        "",
        "nix_cpp_node_addon(",
        '  name = "addon",',
        '  srcs = ["src/binding.cc"],',
        '  link_deps = ["//projects/libs/greeter:greeter"],',
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
    })`buck2 --isolation-dir ${inheritedBuckIsolation("cpp_addon_link_deps")} cquery "deps(//projects/libs/addon-native:addon)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return;

    await $({
      cwd: tmp,
    })`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, BUCK_TARGET: "//projects/libs/addon-native:addon" },
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
      "if (v !== 123) { console.error('bad answer', v); process.exit(3); }",
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
