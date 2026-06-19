#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

async function nixBuildSelected(tmp: string, $: any, target: string): Promise<string> {
  const resolveJson = JSON.stringify({
    builddep: {
      version: "1.0.0",
      originPath: path.join(
        "projects",
        "apps",
        "pyext_wasm_build_deps",
        "vendor",
        "builddep-1.0.0",
      ),
    },
  });
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
      NIX_PY_TEST_RESOLVE_JSON: resolveJson,
    },
  })`nix build --impure -L ${`path:${await workspaceFlakeRef(tmp)}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
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

test("python: pyext_wasm build_py_deps headers are available", async () => {
  await runInTemp("python-pyext-wasm-build-deps", async (tmp, $) => {
    const appRel = path.join("projects", "apps", "pyext_wasm_build_deps");
    const appDir = path.join(tmp, appRel);
    await fs.mkdirp(path.join(appDir, "native"));
    await fs.mkdirp(path.join(appDir, "src", "demo"));

    const origin = path.join(appDir, "vendor", "builddep-1.0.0");
    await fs.mkdirp(path.join(origin, "builddep", "include"));
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
      ["# uv lock", "[[package]]", 'name = "builddep"', 'version = "1.0.0"', ""].join("\n"),
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

    const relPosix = appRel.replace(/\\/g, "/");
    const extLabel = `//${relPosix}:ext`;
    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fs.mkdirp(graphDir);
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: extLabel,
            rule_type: "python_pyext_stub",
            labels: ["lang:python", "kind:pyext_wasm", "backend:pyodide"],
            module: "demo._native",
            srcs: [`${relPosix}/native/ext.c`],
            deps: [],
            cflags: [],
            ldflags: [],
            build_py_deps: ["builddep"],
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const outPath = await nixBuildSelected(tmp, $, extLabel);
    const outDir = path.join(outPath, "site", "demo");
    const entries = (await fs.readdir(outDir)).filter(Boolean);
    const hit = entries.find((entry) => entry.startsWith("_native") && entry.endsWith(".so"));
    assert.ok(hit, `expected extension under ${outDir}, got: ${entries.join(", ")}`);
  });
});
