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

test("cpp default link_mode=static still links via link_deps", async () => {
  await runInTemp("cpp-link-mode-static-default", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "build-tools", "tools", "nix", "langs.json"),
      JSON.stringify({ enabled: ["cpp"] }, null, 2) + "\n",
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "core", "include", "core.h"),
      ["#pragma once", "int core_value();", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "core", "src", "core.cpp"),
      ['#include "../include/core.h"', "int core_value() { return 9; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "core", "TARGETS"),
      [
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "core",',
        '  srcs = ["src/core.cpp", "include/core.h"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "apps", "demo", "src", "main.cpp"),
      [
        "#include <core.h>",
        "#include <cstdio>",
        "int main() {",
        '  std::printf("value=%d\\n", core_value());',
        "  return 0;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "projects", "apps", "demo", "TARGETS"),
      [
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_binary")',
        "",
        "nix_cpp_binary(",
        '  name = "demo",',
        '  srcs = ["src/main.cpp"],',
        '  link_deps = ["//projects/libs/core:core"],',
        '  labels = ["lang:cpp", "kind:bin"],',
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
    })`buck2 --isolation-dir ${inheritedBuckIsolation("cpp_link_mode_static")} cquery "deps(//projects/apps/demo:demo)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return;

    await $({
      cwd: tmp,
    })`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, BUCK_TARGET: "//projects/apps/demo:demo" },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    assert.equal(build.exitCode, 0, String(build.stderr || build.stdout));

    const outPath = parseOutPath(build.stdout);
    const binDir = path.join(outPath, "bin");
    const bins = (await fs.readdir(binDir).catch(() => [])) as string[];
    assert.ok(bins.length > 0, `no binaries found under ${binDir}`);
    const res = await $({ cwd: tmp, stdio: "pipe" })`${path.join(binDir, bins[0])}`;
    assert.match(String(res.stdout || ""), /^value=9\b/m);
  });
});
