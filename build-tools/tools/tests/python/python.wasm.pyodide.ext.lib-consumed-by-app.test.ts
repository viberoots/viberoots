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
        hello: { version: "1.0.0", originPath: "projects/apps/pywasm/vendor/hello" },
        world: { version: "0.1.0", originPath: "projects/libs/pylib/vendor/world" },
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

test("python wasm (pyodide): app consumes lib overlay with extension", async () => {
  await runInTemp("py-wasm-pyodide-ext-lib", async (tmp, $) => {
    const libRel = path.join("projects", "libs", "pylib");
    const libDir = path.join(tmp, libRel);
    await fs.mkdir(path.join(libDir, "src", "world"), { recursive: true });
    await fs.mkdir(path.join(libDir, "native"), { recursive: true });
    await fs.writeFile(path.join(libDir, "src", "world", "__init__.py"), "", "utf8");
    await fs.writeFile(
      path.join(libDir, "uv.lock"),
      ["[[package]]", 'name = "world"', 'version = "0.1.0"'].join("\n") + "\n",
      "utf8",
    );
    const vendorLib = path.join(libDir, "vendor", "world");
    await fs.mkdir(path.join(vendorLib, "world"), { recursive: true });
    await fs.writeFile(path.join(vendorLib, "world", "__init__.py"), "FLAG=True\n", "utf8");
    await fs.writeFile(
      path.join(libDir, "native", "ext.c"),
      [
        "#include <Python.h>",
        "",
        "static PyObject* add_wrap(PyObject* self, PyObject* args) {",
        "  int a = 0;",
        "  int b = 0;",
        '  if (!PyArg_ParseTuple(args, "ii", &a, &b)) {',
        "    return NULL;",
        "  }",
        "  return PyLong_FromLong((long)(a + b));",
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
      `
load("//build-tools/python:defs.bzl", "nix_python_wasm_lib", "nix_python_wasm_extension_module")

nix_python_wasm_extension_module(
  name = "ext",
  module = "world._native",
  srcs = ["native/ext.c"],
  labels = ["backend:pyodide"],
  lockfile_label = "lockfile:projects/libs/pylib/uv.lock#projects/libs/pylib",
)

nix_python_wasm_lib(
  name = "pylib",
  labels = ["backend:pyodide"],
  lockfile_label = "lockfile:projects/libs/pylib/uv.lock#projects/libs/pylib",
  srcs = glob(["**/*.py"]),
  deps = [":ext"],
  visibility = ["PUBLIC"],
)
`,
      "utf8",
    );

    const appRel = path.join("projects", "apps", "pywasm");
    const appDir = path.join(tmp, appRel);
    await fs.mkdir(path.join(appDir, "bin"), { recursive: true });
    await fs.mkdir(path.join(appDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(appDir, "bin", "__main__.py"),
      ["from world import _native", 'print(f"RESULT={_native.add(2, 3)}")', ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["[[package]]", 'name = "hello"', 'version = "1.0.0"'].join("\n") + "\n",
      "utf8",
    );
    const vendorApp = path.join(appDir, "vendor", "hello");
    await fs.mkdir(path.join(vendorApp, "hello"), { recursive: true });
    await fs.writeFile(path.join(vendorApp, "hello", "__init__.py"), 'VALUE="one"\n', "utf8");
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      `
load("//build-tools/python:defs.bzl", "nix_python_wasm_app")

nix_python_wasm_app(
  name = "pyapp",
  labels = ["backend:pyodide"],
  lockfile_label = "lockfile:projects/apps/pywasm/uv.lock#projects/apps/pywasm",
  srcs = glob(["**/*.py"]),
  deps = ["//projects/libs/pylib:pylib"],
)
`,
      "utf8",
    );

    await $`node build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    const outPath = await nixBuildSelected(tmp, $, "//projects/apps/pywasm:pyapp");
    const outDir = path.join(outPath, "site", "world");
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
