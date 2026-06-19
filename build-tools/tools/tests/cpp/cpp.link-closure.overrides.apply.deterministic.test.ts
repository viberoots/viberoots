#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { sanitizeName } from "../../lib/sanitize";
import { inheritedBuckIsolation, runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

function extractBuildLogLine(buildLog: string, key: string): string {
  const prefix = `${key}=`;
  for (const line of buildLog.split(/\r?\n/)) {
    if (line.startsWith(prefix)) return line.slice(prefix.length);
  }
  return "";
}

function parseOutPath(stdout: unknown): string {
  return String(stdout || "")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop()!;
}

test("cpp: link_closure_overrides apply deterministically (ordering locked by build.log)", async () => {
  await runInTemp("cpp-link-closure-overrides", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "viberoots", "build-tools", "tools", "nix", "langs.json"),
      JSON.stringify({ enabled: ["cpp"] }, null, 2) + "\n",
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "support", "src", "support.cpp"),
      ["int support_answer() { return 10; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "core", "src", "core.cpp"),
      [
        "extern int support_answer();",
        "int core_answer() {",
        "  return support_answer() + 1;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "alpha", "src", "alpha.cpp"),
      ["int alpha_answer() { return 1; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "apps", "demo", "src", "main.cpp"),
      [
        "extern int core_answer();",
        "extern int alpha_answer();",
        "int main() {",
        "  return (core_answer() + alpha_answer()) == 12 ? 0 : 1;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "support", "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "support",',
        '  srcs = ["src/support.cpp"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "core", "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "core",',
        '  srcs = ["src/core.cpp"],',
        '  link_deps = ["//projects/libs/support:support"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "alpha", "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "alpha",',
        '  srcs = ["src/alpha.cpp"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        '  visibility = ["PUBLIC"],',
        ")",
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
        '  link_deps = ["//projects/libs/core:core", "//projects/libs/alpha:alpha"],',
        '  link_closure = "direct",',
        "  link_closure_overrides = {",
        '    "//projects/libs/core:core": "transitive",',
        "  },",
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
    })`buck2 --isolation-dir ${inheritedBuckIsolation("cpp_link_closure_overrides")} cquery "deps(//projects/apps/demo:demo)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return;

    await $({
      cwd: tmp,
    })`node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    const build1 = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      reject: false,
      env: { ...process.env, BUCK_TARGET: "//projects/apps/demo:demo" },
    })`nix build --impure -L ${`path:${await workspaceFlakeRef(tmp)}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    if (build1.exitCode !== 0) {
      throw new Error(String(build1.stderr || build1.stdout));
    }
    const out1 = parseOutPath(build1.stdout);
    const log1 = await fs.readFile(path.join(out1, "build.log"), "utf8");
    const linkLibs1 = extractBuildLogLine(log1, "link_libs");
    if (!linkLibs1) {
      throw new Error(`expected build.log to include link_libs=...; got:\n${log1}`);
    }

    const expected = [
      `-l${sanitizeName("//projects/libs/core:core")}`,
      `-l${sanitizeName("//projects/libs/support:support")}`,
      `-l${sanitizeName("//projects/libs/alpha:alpha")}`,
    ].join(" ");
    if (linkLibs1.trim() !== expected) {
      throw new Error(
        `expected deterministic link_libs order:\nwant=${expected}\ngot=${linkLibs1}`,
      );
    }

    const build2 = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      reject: false,
      env: { ...process.env, BUCK_TARGET: "//projects/apps/demo:demo" },
    })`nix build --impure -L ${`path:${await workspaceFlakeRef(tmp)}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    if (build2.exitCode !== 0) {
      throw new Error(String(build2.stderr || build2.stdout));
    }
    const out2 = parseOutPath(build2.stdout);
    const log2 = await fs.readFile(path.join(out2, "build.log"), "utf8");
    if (log1 !== log2) {
      throw new Error(
        `expected build.log to be identical across repeated builds\nbefore:\n${log1}\nafter:\n${log2}`,
      );
    }
  });
});
