#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { sanitizeName } from "../../lib/sanitize";
import { runInTemp } from "../lib/test-helpers";

function parseOutPath(stdout: unknown): string {
  return String(stdout || "")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop()!;
}

function extractBuildLogLine(buildLog: string, key: string): string {
  const prefix = `${key}=`;
  for (const line of buildLog.split(/\r?\n/)) {
    if (line.startsWith(prefix)) return line.slice(prefix.length);
  }
  return "";
}

test("cpp: header_deps on a library does not add link inputs", async () => {
  await runInTemp("cpp-header-deps-library-no-link", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "build-tools", "tools", "nix", "langs.json"),
      JSON.stringify({ enabled: ["cpp"] }, null, 2) + "\n",
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "dep", "src", "dep.cpp"),
      ['#include "dep.h"', "int dep_answer() { return 7; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "dep", "src", "dep.h"),
      [
        "#pragma once",
        "constexpr int dep_header_value() { return 3; }",
        "int dep_answer();",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "dep", "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "dep",',
        '  srcs = ["src/dep.cpp", "src/dep.h"],',
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
        "#include <src/dep.h>",
        "int main() {",
        "  return dep_header_value() == 3 ? 0 : 1;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "apps", "demo", "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_binary")',
        "",
        "nix_cpp_binary(",
        '  name = "demo",',
        '  srcs = ["src/main.cpp"],',
        '  header_deps = ["//libs/dep:dep"],',
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
    })`buck2 --isolation-dir cpp_header_deps_lib_nolink cquery "deps(//apps/demo:demo)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return;

    await $({
      cwd: tmp,
    })`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      reject: false,
      env: { ...process.env, BUCK_TARGET: "//apps/demo:demo" },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    assert.equal(build.exitCode, 0, String(build.stderr || build.stdout));

    const out = parseOutPath(build.stdout);
    const log = await fs.readFile(path.join(out, "build.log"), "utf8");
    const linkLibs = extractBuildLogLine(log, "link_libs");
    const forbidden = `-l${sanitizeName("//libs/dep:dep")}`;
    assert.ok(
      !linkLibs.includes(forbidden),
      `expected no ${forbidden} in link_libs; got ${linkLibs}`,
    );
  });
});
