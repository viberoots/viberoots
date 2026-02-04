#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { readGraph } from "../../lib/graph.ts";
import { runInTemp } from "../lib/test-helpers";

test("inline exporter: python pyext_wasm nodes include module attrs in inline graph", async () => {
  await runInTemp("python-pyext-wasm-inline-exported-attrs", async (tmp, $) => {
    const appRel = path.join("apps", "pyext_wasm_inline_export");
    const app = path.join(tmp, appRel);
    await fs.mkdirp(path.join(app, "native"));
    await fs.writeFile(path.join(app, "native", "ext.c"), "int x(){return 1;}\n", "utf8");
    await fs.writeFile(
      path.join(app, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(app, "TARGETS"),
      [
        'load("//python:defs.bzl", "nix_python_wasm_extension_module")',
        "",
        "nix_python_wasm_extension_module(",
        '  name = "ext",',
        '  lockfile_label = "lockfile:apps/pyext_wasm_inline_export/uv.lock#apps/pyext_wasm_inline_export",',
        '  labels = ["backend:wasi"],',
        '  module = "demo._native",',
        '  srcs = ["native/ext.c"],',
        '  cflags = ["-DHELLO=1"],',
        '  ldflags = ["-Wl,-dead_strip"],',
        '  build_py_deps = ["pybind11"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const graphPath = path.join(tmp, "build-tools", "tools", "buck", "graph.inline.json");
    await fs.mkdirp(path.dirname(graphPath));

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`node build-tools/tools/buck/export-inline.ts --out ${graphPath} --roots apps --normalize`;
    if (res.exitCode !== 0) return;

    const nodes = await readGraph(graphPath);
    const label = `//${appRel.replace(/\\/g, "/")}:ext`;
    const node = nodes.find((n) => String(n.name || "") === label);
    assert.ok(node, `missing node ${label}`);

    const labels = (node?.labels || []).map(String).sort();
    assert.ok(labels.includes("lang:python"), "missing lang:python label");
    assert.ok(labels.includes("kind:pyext_wasm"), "missing kind:pyext_wasm label");
    assert.ok(labels.includes("backend:wasi"), "missing backend:wasi label");

    assert.equal(String((node as any).module || ""), "demo._native");
    const cflags = (node as any).cflags as unknown;
    const ldflags = (node as any).ldflags as unknown;
    const buildPyDeps = (node as any).build_py_deps as unknown;
    assert.deepEqual(Array.isArray(cflags) ? cflags : [], ["-DHELLO=1"]);
    assert.deepEqual(Array.isArray(ldflags) ? ldflags : [], ["-Wl,-dead_strip"]);
    assert.deepEqual(Array.isArray(buildPyDeps) ? buildPyDeps : [], ["pybind11"]);
  });
});
