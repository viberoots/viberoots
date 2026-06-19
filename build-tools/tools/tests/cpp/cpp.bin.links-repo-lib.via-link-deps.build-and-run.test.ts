#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs-extra";
import path from "node:path";
import { inheritedBuckIsolation, runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

function parseOutPath(stdout: unknown): string {
  return String(stdout || "")
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()!;
}

test("cpp bin links an in-repo C++ lib via link_deps (build + run)", async () => {
  await runInTemp("cpp-bin-links-repo-lib", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "viberoots", "build-tools", "tools", "nix", "langs.json"),
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
      ['#include "../include/greeter.h"', "int greeter_answer() { return 7; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "greeter", "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")',
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
      path.join(tmp, "apps", "demo", "src", "main.cpp"),
      [
        "#include <greeter.h>",
        "#include <cstdio>",
        "int main() {",
        '  std::printf("answer=%d\\n", greeter_answer());',
        "  return 0;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "apps", "demo", "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_binary")',
        "",
        "nix_cpp_binary(",
        '  name = "demo",',
        '  srcs = ["src/main.cpp"],',
        '  link_deps = ["//projects/libs/greeter:greeter"],',
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
    })`buck2 --isolation-dir ${inheritedBuckIsolation("cpp_bin_link_deps")} cquery "deps(//projects/apps/demo:demo)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return;

    await $({
      cwd: tmp,
    })`node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, BUCK_TARGET: "//projects/apps/demo:demo" },
    })`nix build --impure -L ${`path:${await workspaceFlakeRef(tmp)}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    assert.equal(build.exitCode, 0, String(build.stderr || build.stdout));

    const outPath = parseOutPath(build.stdout);
    const binDir = path.join(outPath, "bin");
    const bins = (await fs.readdir(binDir).catch(() => [])) as string[];
    assert.ok(bins.length > 0, `no binaries found under ${binDir}`);
    const res = await $({ cwd: tmp, stdio: "pipe" })`${path.join(binDir, bins[0])}`;
    assert.match(String(res.stdout || ""), /^answer=7\b/m);
  });
});
