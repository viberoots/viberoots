#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python wasm (pyodide): backend mismatch fails fast", async () => {
  await runInTemp("py-wasm-pyodide-ext-mismatch", async (tmp, $) => {
    const appRel = path.join("apps", "pywasm");
    const appDir = path.join(tmp, appRel);
    await fs.mkdir(path.join(appDir, "src", "demo"), { recursive: true });
    await fs.mkdir(path.join(appDir, "native"), { recursive: true });

    await fs.writeFile(path.join(appDir, "src", "demo", "__init__.py"), "", "utf8");
    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["[[package]]", 'name = "hello"', 'version = "1.0.0"'].join("\n") + "\n",
      "utf8",
    );
    const vendor = path.join(appDir, "vendor", "hello");
    await fs.mkdir(path.join(vendor, "hello"), { recursive: true });
    await fs.writeFile(path.join(vendor, "hello", "__init__.py"), 'VALUE="one"\n', "utf8");

    await fs.writeFile(
      path.join(appDir, "native", "ext.c"),
      [
        "#include <Python.h>",
        "",
        "static PyMethodDef Methods[] = {",
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
load("//python:defs.bzl", "nix_python_wasm_app", "nix_python_wasm_extension_module")

nix_python_wasm_extension_module(
  name = "ext",
  module = "demo._native",
  srcs = ["native/ext.c"],
  labels = ["backend:wasi"],
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
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        BUCK_TARGET: "//apps/pywasm:pyapp",
        WORKSPACE_ROOT: tmp,
        BUCK_TEST_SRC: tmp,
        PY_WASM_BACKEND: "pyodide",
        NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
          hello: { version: "1.0.0", originPath: "apps/pywasm/vendor/hello" },
        }),
      },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    assert.notEqual(res.exitCode, 0, "expected nix build to fail");
    const stderr = String(res.stderr || "");
    assert.match(stderr, /kind:pyext_wasm/);
    assert.match(stderr, /backend:pyodide/);
  });
});
