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
      PY_WASM_BACKEND: "wasi",
      NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
        hello: { version: "1.0.0", originPath: "apps/pywasm/vendor/hello" },
        world: { version: "0.1.0", originPath: "libs/pylib/vendor/world" },
      }),
    },
  })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
  if (res.exitCode == 0) {
    throw new Error("expected nix build to fail for WASI pyext_wasm");
  }
  const stderr = String(res.stderr || "");
  assert.match(stderr, /wasi does not support kind:pyext_wasm/);
  return "";
}

test("python wasm (wasi): app consumes lib overlay with extension", async () => {
  await runInTemp("py-wasm-wasi-ext-lib", async (tmp, $) => {
    const libRel = path.join("libs", "pylib");
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
load("//python:defs.bzl", "nix_python_wasm_lib", "nix_python_wasm_extension_module")

nix_python_wasm_extension_module(
  name = "ext",
  module = "world._native",
  srcs = ["native/ext.c"],
  labels = ["backend:wasi"],
  lockfile_label = "lockfile:libs/pylib/uv.lock#libs/pylib",
)

nix_python_wasm_lib(
  name = "pylib",
  labels = ["backend:wasi"],
  lockfile_label = "lockfile:libs/pylib/uv.lock#libs/pylib",
  srcs = glob(["**/*.py"]),
  deps = [":ext"],
  visibility = ["PUBLIC"],
)
`,
      "utf8",
    );

    const appRel = path.join("apps", "pywasm");
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
load("//python:defs.bzl", "nix_python_wasm_app")

nix_python_wasm_app(
  name = "pyapp",
  labels = ["backend:wasi"],
  lockfile_label = "lockfile:apps/pywasm/uv.lock#apps/pywasm",
  srcs = glob(["**/*.py"]),
  deps = ["//libs/pylib:pylib"],
)
`,
      "utf8",
    );

    await $`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
    await nixBuildSelected(tmp, $, "//apps/pywasm:pyapp");
  });
});
