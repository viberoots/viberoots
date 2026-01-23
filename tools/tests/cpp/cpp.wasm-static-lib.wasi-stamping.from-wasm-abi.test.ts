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

test("cpp wasm static lib stamps wasm:wasi when wasm_abi is wasi", async () => {
  await runInTemp("cpp-wasm-static-lib-wasi-stamping", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "tools", "nix", "langs.json"),
      JSON.stringify({ enabled: ["cpp"] }, null, 2) + "\n",
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "core", "src", "core.c"),
      ["#include <stdint.h>", "int add(int a, int b) { return a + b; }", ""].join("\n"),
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
        '  wasm_abi = "wasi",',
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
    })`buck2 --isolation-dir cpp_wasm_abi_stamping cquery "deps(//libs/core:core_wasm)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return;

    await $({ cwd: tmp })`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    const nodes = await readGraph(path.join(tmp, "tools", "buck", "graph.json"));
    const node = nodes.find(
      (x) => normalizeTargetLabel(String(x.name || "")) === "//libs/core:core_wasm",
    );
    assert.ok(node, "missing node //libs/core:core_wasm");

    const labels = normalizeLabelList((node as any).labels);
    assert.ok(labels.includes("wasm:wasi"), "missing wasm:wasi label");
    assert.ok(labels.includes("wasm_target:wasm32-wasi"), "missing wasm_target label");
  });
});
