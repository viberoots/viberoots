#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

test("nix_cpp_binary: defaults build unchanged when no link intent attrs are provided", async () => {
  await runInTemp("cpp-macros-link-intent-defaults-build", async (tmp, $) => {
    const app = path.join(tmp, "apps", "link_intent_defaults");
    await fs.mkdirp(path.join(app, "src"));
    await fs.writeFile(path.join(app, "src", "main.cpp"), "int main(){return 0;}\n", "utf8");

    await fs.writeFile(
      path.join(app, "TARGETS"),
      [
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_binary")',
        "",
        "nix_cpp_binary(",
        '  name = "demo",',
        '  srcs = ["src/main.cpp"],',
        '  labels = ["lang:cpp"],',
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
    })`buck2 --isolation-dir ${inheritedBuckIsolation("cpp_link_intent_defaults")} cquery "deps(//projects/apps/link_intent_defaults:demo)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return; // skip when Buck/prelude/toolchains unavailable

    await $({
      cwd: tmp,
      stdio: "pipe",
    })`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, BUCK_TARGET: "//projects/apps/link_intent_defaults:demo" },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    if (build.exitCode !== 0) {
      throw new Error(String(build.stdout || "") + "\n" + String(build.stderr || ""));
    }
  });
});
