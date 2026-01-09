#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs-extra";
import path from "node:path";
import { readGraph } from "../../lib/graph";
import { normalizeTargetLabel } from "../../lib/labels.ts";
import { runInTemp } from "../lib/test-helpers";

function normalizeLabelList(xs: unknown): string[] {
  const raw = Array.isArray(xs) ? (xs as unknown[]) : [];
  return raw.map((x) => normalizeTargetLabel(String(x))).filter(Boolean);
}

test("cpp wasm static lib preserves link intent attrs in tools/buck/graph.json", async () => {
  await runInTemp("cpp-wasm-static-lib-link-intent-exported", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "tools", "nix", "langs.json"),
      JSON.stringify({ enabled: ["cpp"] }, null, 2) + "\n",
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "hdrs", "include", "demo.h"),
      ["#pragma once", "inline int demo_answer() { return 42; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "hdrs", "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_headers")',
        "",
        "nix_cpp_headers(",
        '  name = "hdrs",',
        '  srcs = ["include/demo.h"],',
        '  labels = ["lang:cpp", "kind:headers"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "dep", "src", "dep.c"),
      ["#include <stdint.h>", "int dep_add(int a, int b) { return a + b; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "dep", "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_wasm_static_lib")',
        "",
        "nix_cpp_wasm_static_lib(",
        '  name = "dep_wasm",',
        '  srcs = ["src/dep.c"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "core", "src", "core.c"),
      [
        '#include "demo.h"',
        "extern int dep_add(int a, int b);",
        "int core_add(int a, int b) { return dep_add(a, b) + demo_answer(); }",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "core", "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_wasm_static_lib")',
        "",
        "nix_cpp_wasm_static_lib(",
        '  name = "core_wasm",',
        '  srcs = ["src/core.c"],',
        '  link_deps = ["//libs/dep:dep_wasm"],',
        '  header_deps = ["//libs/hdrs:hdrs"],',
        '  labels = ["lang:cpp", "kind:lib"],',
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
    })`buck2 --isolation-dir cpp_wasm_link_intent cquery "deps(//libs/core:core_wasm)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return;

    await $({ cwd: tmp })`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    const nodes = await readGraph(path.join(tmp, "tools", "buck", "graph.json"));
    const node = nodes.find(
      (x) => normalizeTargetLabel(String(x.name || "")) === "//libs/core:core_wasm",
    );
    assert.ok(node, "missing node //libs/core:core_wasm");

    const linkDeps = normalizeLabelList((node as any).link_deps);
    const headerDeps = normalizeLabelList((node as any).header_deps);
    const deps = normalizeLabelList((node as any).deps);

    assert.ok(
      linkDeps.includes("//libs/dep:dep_wasm"),
      "missing link_deps on //libs/core:core_wasm",
    );
    assert.ok(
      headerDeps.includes("//libs/hdrs:hdrs"),
      "missing header_deps on //libs/core:core_wasm",
    );
    assert.ok(
      deps.includes("//libs/dep:dep_wasm"),
      "expected deps to include link_deps (union contract)",
    );
    assert.ok(
      deps.includes("//libs/hdrs:hdrs"),
      "expected deps to include header_deps (union contract)",
    );
  });
});
