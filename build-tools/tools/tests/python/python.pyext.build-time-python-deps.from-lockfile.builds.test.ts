#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function nixBuildSelected(tmp: string, $: any, target: string): Promise<string> {
  const resolveJson = JSON.stringify({
    builddep: {
      version: "1.0.0",
      originPath: path.join("apps", "pyext_build_deps", "vendor", "builddep-1.0.0"),
    },
  });
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
    env: {
      ...process.env,
      BUCK_TEST_SRC: tmp,
      BUCK_TARGET: target,
      WORKSPACE_ROOT: tmp,
      NIX_PY_TEST_RESOLVE_JSON: resolveJson,
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

test("python: pyext build-time deps can provide headers via importer uv.lock wheelhouse", async () => {
  await runInTemp("python-pyext-buildtime-deps", async (tmp, $) => {
    const appRel = path.join("apps", "pyext_build_deps");
    const appDir = path.join(tmp, appRel);

    await fs.mkdirp(path.join(appDir, "bin"));
    await fs.mkdirp(path.join(appDir, "src", "demo"));
    await fs.mkdirp(path.join(appDir, "native"));

    // Fake header-providing Python package in vendor/ (resolved by NIX_PY_TEST_RESOLVE_JSON).
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
      ["#pragma once", "#define BUILDDEP_MAGIC 123", ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "builddep"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(path.join(appDir, "src", "demo", "__init__.py"), "", "utf8");
    await fs.writeFile(
      path.join(appDir, "bin", "__main__.py"),
      ["import demo._native as n", "print(n.magic())", ""].join("\n"),
      "utf8",
    );

    // Extension source uses a header that comes from build-time Python deps (wheelhouse site-packages).
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
    const binLabel = `//${relPosix}:app`;

    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
    await fs.mkdirp(graphDir);
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: extLabel,
            rule_type: "python_pyext_stub",
            labels: ["lang:python", "kind:pyext"],
            module: "demo._native",
            srcs: [`${relPosix}/native/ext.c`],
            deps: [],
            cflags: [],
            ldflags: [],
            build_py_deps: ["builddep"],
          },
          {
            name: binLabel,
            rule_type: "python_binary",
            labels: ["lang:python", "kind:bin"],
            srcs: [`${relPosix}/bin/__main__.py`],
            deps: [extLabel],
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const outPath = await nixBuildSelected(tmp, $, binLabel);
    const binDir = path.join(outPath, "bin");
    const bins = (await fs.readdir(binDir)).filter(Boolean);
    assert.ok(bins.length >= 1, `expected at least one wrapper in ${binDir}`);

    const wrapper = path.join(binDir, bins[0]!);
    const resolveJson = JSON.stringify({
      builddep: {
        version: "1.0.0",
        originPath: path.join("apps", "pyext_build_deps", "vendor", "builddep-1.0.0"),
      },
    });
    const run = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        NIX_PY_TEST_RESOLVE_JSON: resolveJson,
      },
    })`${wrapper}`;
    assert.equal(run.exitCode, 0, String(run.stderr || ""));
    assert.equal(String(run.stdout || "").trim(), "123");
  });
});
