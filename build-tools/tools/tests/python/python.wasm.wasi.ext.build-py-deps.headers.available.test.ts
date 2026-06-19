#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

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
        builddep: {
          version: "1.0.0",
          originPath: "projects/apps/pywasm/vendor/builddep-1.0.0",
        },
      }),
    },
  })`nix build --impure -L ${`path:${await workspaceFlakeRef(tmp)}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
  if (res.exitCode == 0) {
    throw new Error("expected nix build to fail for WASI pyext_wasm");
  }
  const stderr = String(res.stderr || "");
  assert.match(stderr, /wasi does not support kind:pyext_wasm/);
  return "";
}

test("python wasm (wasi): extension build_py_deps headers are available", async () => {
  await runInTemp("py-wasm-wasi-ext-build-deps", async (tmp, $) => {
    const appRel = path.join("projects", "apps", "pywasm");
    const appDir = path.join(tmp, appRel);
    await fs.mkdir(path.join(appDir, "bin"), { recursive: true });
    await fs.mkdir(path.join(appDir, "src", "demo"), { recursive: true });
    await fs.mkdir(path.join(appDir, "native"), { recursive: true });

    const origin = path.join(appDir, "vendor", "builddep-1.0.0");
    await fs.mkdir(path.join(origin, "builddep", "include"), { recursive: true });
    await fs.writeFile(
      path.join(origin, "builddep", "__init__.py"),
      [
        "import os",
        "",
        "def get_include() -> str:",
        "    return os.path.join(os.path.dirname(__file__), 'include')",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(origin, "builddep", "include", "builddep.h"),
      ["#pragma once", "#define BUILDDEP_MAGIC 7", ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["[[package]]", 'name = "builddep"', 'version = "1.0.0"'].join("\n") + "\n",
      "utf8",
    );
    await fs.writeFile(path.join(appDir, "src", "demo", "__init__.py"), "", "utf8");

    await fs.writeFile(
      path.join(appDir, "native", "ext.c"),
      [
        "#include <Python.h>",
        '#include "builddep.h"',
        "",
        "static PyObject* magic(PyObject* self, PyObject* args) {",
        "  (void)self;",
        "  (void)args;",
        "  return PyLong_FromLong((long)BUILDDEP_MAGIC);",
        "}",
        "",
        "static PyMethodDef Methods[] = {",
        '  {"magic", magic, METH_NOARGS, NULL},',
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
      path.join(appDir, "TARGETS"),
      `
load("@viberoots//build-tools/python:defs.bzl", "nix_python_wasm_app", "nix_python_wasm_extension_module")

nix_python_wasm_extension_module(
  name = "ext",
  module = "demo._native",
  srcs = ["native/ext.c"],
  build_py_deps = ["builddep"],
  labels = ["backend:wasi"],
  lockfile_label = "lockfile:projects/apps/pywasm/uv.lock#projects/apps/pywasm",
)

nix_python_wasm_app(
  name = "pyapp",
  labels = ["backend:wasi"],
  lockfile_label = "lockfile:projects/apps/pywasm/uv.lock#projects/apps/pywasm",
  srcs = glob(["**/*.py"]),
  deps = [":ext"],
)
`,
      "utf8",
    );

    await $`node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    await nixBuildSelected(tmp, $, "//projects/apps/pywasm:pyapp");
  });
});
