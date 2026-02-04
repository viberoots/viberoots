#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function nixEvalSelectedDrvPath(tmp: string, $: any, target: string): Promise<string> {
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
    },
  })`nix eval --impure -L --accept-flake-config --raw ${`path:${tmp}#graph-generator-selected.drvPath`}`;
  if (res.exitCode !== 0) {
    console.error(String(res.stderr || ""));
    throw new Error(`nix eval failed (exit=${res.exitCode})`);
  }
  const drvPath = String(res.stdout || "").trim();
  assert.ok(drvPath.startsWith("/nix/store/"), `expected nix drvPath, got: ${drvPath}`);
  assert.ok(drvPath.endsWith(".drv"), `expected nix drvPath, got: ${drvPath}`);
  return drvPath;
}

test("python: patch change in linked C++ producer rebuilds pyext consumer runtime", async () => {
  await runInTemp("python-pyext-patch-invalidation", async (tmp, $) => {
    const appRel = path.join("apps", "pyext_patch_inv");
    const appDir = path.join(tmp, appRel);
    const libRel = path.join("libs", "cpp_math");
    const libDir = path.join(tmp, libRel);

    const libPatchRel = path.join(libRel, "patches", "cpp", "math@0.0.0.patch").replace(/\\/g, "/");
    const libPatchAbs = path.join(tmp, libPatchRel);

    await fs.mkdirp(path.join(appDir, "native"));
    await fs.mkdirp(path.join(libDir, "src"));
    await fs.mkdirp(path.dirname(libPatchAbs));

    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(libDir, "src", "add.cc"),
      ['extern "C" int add(int a, int b) { return 0; }', ""].join("\n"),
      "utf8",
    );

    const patchV1 = [
      "diff --git a/src/add.cc b/src/add.cc",
      "--- a/src/add.cc",
      "+++ b/src/add.cc",
      "@@ -1 +1 @@",
      '-extern "C" int add(int a, int b) { return 0; }',
      '+extern "C" int add(int a, int b) { return a + b; }',
      "",
    ].join("\n");
    await fs.writeFile(libPatchAbs, patchV1, "utf8");

    await fs.writeFile(
      path.join(appDir, "native", "ext.cpp"),
      [
        "#include <Python.h>",
        "",
        'extern "C" int add(int a, int b);',
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

    const relPosix = appRel.replace(/\\/g, "/");
    const libPosix = libRel.replace(/\\/g, "/");
    const libLabel = `//${libPosix}:math`;
    const extLabel = `//${relPosix}:ext`;

    await fs.mkdirp(path.join(tmp, "build-tools", "tools", "buck"));
    await fs.writeFile(
      path.join(tmp, "build-tools", "tools", "buck", "graph.json"),
      JSON.stringify(
        [
          {
            name: libLabel,
            rule_type: "cxx_library",
            labels: ["lang:cpp", "kind:lib"],
            srcs: [`${libPosix}/src/add.cc`, libPatchRel],
            deps: [],
            link_deps: [],
            header_deps: [],
          },
          {
            name: extLabel,
            rule_type: "python_pyext_stub",
            labels: ["lang:python", "kind:pyext"],
            module: "demo._native",
            srcs: [`${relPosix}/native/ext.cpp`],
            deps: [libLabel],
            link_deps: [libLabel],
            header_deps: [],
            link_closure: "direct",
            link_closure_overrides: {},
            cflags: [],
            ldflags: [],
            build_py_deps: [],
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const drv1 = await nixEvalSelectedDrvPath(tmp, $, extLabel);

    const patchV2 = patchV1.replace("return a + b;", "return a + b + 1;");
    await fs.writeFile(libPatchAbs, patchV2, "utf8");

    const drv2 = await nixEvalSelectedDrvPath(tmp, $, extLabel);
    assert.notEqual(drv1, drv2, `expected drvPath to change after patch edit; drv=${drv1}`);
  });
});
