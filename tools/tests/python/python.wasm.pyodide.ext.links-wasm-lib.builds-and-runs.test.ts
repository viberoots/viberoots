#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function nixBuildSelected(tmp: string, $: any, target: string): Promise<string> {
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
    env: {
      ...process.env,
      BUCK_TARGET: target,
      WORKSPACE_ROOT: tmp,
      BUCK_TEST_SRC: tmp,
      PY_WASM_BACKEND: "pyodide",
      NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
        hello: { version: "1.0.0", originPath: "apps/pywasm/vendor/hello" },
      }),
    },
  })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
  if (res.exitCode !== 0) {
    console.error(String(res.stderr || ""));
    throw new Error(`nix build failed (exit=${res.exitCode})`);
  }
  const outPath =
    String(res.stdout || "")
      .trim()
      .split(/\n+/)
      .pop() || "";
  assert.ok(outPath.startsWith("/"), `expected nix out path, got: ${outPath}`);
  return outPath;
}

test("python wasm (pyodide): extension links a wasm static lib (build + overlay)", async () => {
  await runInTemp("py-wasm-pyodide-ext-link-wasm", async (tmp, $) => {
    const appRel = path.join("apps", "pywasm");
    const appDir = path.join(tmp, appRel);
    const libRel = path.join("libs", "wasm-math");
    const libDir = path.join(tmp, libRel);

    await fs.mkdir(path.join(appDir, "bin"), { recursive: true });
    await fs.mkdir(path.join(appDir, "src", "demo"), { recursive: true });
    await fs.mkdir(path.join(appDir, "native"), { recursive: true });
    await fs.mkdir(path.join(libDir, "include"), { recursive: true });
    await fs.mkdir(path.join(libDir, "src"), { recursive: true });

    await fs.writeFile(path.join(appDir, "src", "demo", "__init__.py"), "", "utf8");
    await fs.writeFile(
      path.join(appDir, "bin", "__main__.py"),
      ["from demo import _native", 'print(f"RESULT={_native.add(2, 3)}")', ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["[[package]]", 'name = "hello"', 'version = "1.0.0"'].join("\n") + "\n",
      "utf8",
    );
    const vendor = path.join(appDir, "vendor", "hello");
    await fs.mkdir(path.join(vendor, "hello"), { recursive: true });
    await fs.writeFile(path.join(vendor, "hello", "__init__.py"), 'VALUE="one"\n', "utf8");

    await fs.writeFile(
      path.join(libDir, "include", "addon.h"),
      [
        "#ifndef WASM_MATH_ADDON_H",
        "#define WASM_MATH_ADDON_H",
        "int add(int a, int b);",
        "#endif",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(libDir, "src", "addon.c"),
      ['#include "../include/addon.h"', "int add(int a, int b) { return a + b; }", ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(appDir, "native", "ext.c"),
      [
        "#include <Python.h>",
        '#include "include/addon.h"',
        "",
        "static PyObject* add_wrap(PyObject* self, PyObject* args) {",
        "  int a = 0;",
        "  int b = 0;",
        '  if (!PyArg_ParseTuple(args, "ii", &a, &b)) {',
        "    return NULL;",
        "  }",
        "  return PyLong_FromLong((long)add(a, b));",
        "}",
        "",
        "static PyMethodDef Methods[] = {",
        '  {"add", add_wrap, METH_VARARGS, NULL},',
        "  {NULL, NULL, 0, NULL},",
        "};",
        "",
        "static struct PyModuleDef moduledef = {",
        "  PyModuleDef_HEAD_INIT,",
        '  "_native",',
        "  NULL,",
        "  -1,",
        "  Methods,",
        "};",
        "",
        "PyMODINIT_FUNC PyInit__native(void) {",
        "  return PyModule_Create(&moduledef);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(libDir, "TARGETS"),
      `load("//cpp:defs.bzl", "nix_cpp_wasm_static_lib")

nix_cpp_wasm_static_lib(
  name = "math_wasm",
  srcs = ["src/addon.c"],
  headers = ["include/addon.h"],
  labels = ["kind:lib"],
  visibility = ["PUBLIC"],
)
`,
      "utf8",
    );

    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      `load("//python:defs.bzl", "nix_python_wasm_app", "nix_python_wasm_extension_module")

nix_python_wasm_extension_module(
  name = "ext",
  module = "demo._native",
  srcs = ["native/ext.c"],
  link_deps = ["//libs/wasm-math:math_wasm"],
  labels = ["backend:pyodide"],
  lockfile_label = "lockfile:apps/pywasm/uv.lock#apps/pywasm",
)

nix_python_wasm_app(
  name = "pyapp",
  labels = ["backend:pyodide"],
  lockfile_label = "lockfile:apps/pywasm/uv.lock#apps/pywasm",
  srcs = glob(["**/*.py"]),
  deps = [":ext"],
)
`,
      "utf8",
    );

    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    const outPath = await nixBuildSelected(tmp, $, "//apps/pywasm:pyapp");
    const outDir = path.join(outPath, "site", "demo");
    const entries = await fs.readdir(outDir);
    const hit = entries.find((entry) => entry.startsWith("_native") && entry.endsWith(".so"));
    assert.ok(hit, `expected extension under ${outDir}, got: ${entries.join(", ")}`);

    const runJs = path.join(outPath, "bin", "run.mjs");
    const runOut = await $`node ${runJs}`;
    const stdout = String(runOut.stdout || "");
    assert.match(stdout, /nativeOverlays=1/);
    assert.match(stdout, /RESULT=5/);
  });
});
