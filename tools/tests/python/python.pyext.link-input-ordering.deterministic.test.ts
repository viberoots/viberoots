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

test("python: pyext link input ordering is deterministic across builds", async () => {
  await runInTemp("python-pyext-link-order", async (tmp, $) => {
    const appRel = path.join("apps", "pyext_link_order");
    const appDir = path.join(tmp, appRel);
    const libARel = path.join("libs", "pick_a");
    const libBRel = path.join("libs", "pick_b");
    const libADir = path.join(tmp, libARel);
    const libBDir = path.join(tmp, libBRel);

    await fs.mkdirp(path.join(appDir, "native"));
    await fs.mkdirp(path.join(libADir, "src"));
    await fs.mkdirp(path.join(libBDir, "src"));

    await fs.writeFile(
      path.join(libADir, "src", "pick.cc"),
      ['extern "C" int pick() { return 1; }', ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(libBDir, "src", "pick.cc"),
      ['extern "C" int pick() { return 2; }', ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(appDir, "native", "ext.cpp"),
      [
        "#include <Python.h>",
        "",
        'extern "C" int pick();',
        "",
        "static PyObject* pick_wrap(PyObject* self, PyObject* args) {",
        "  return PyLong_FromLong((long)pick());",
        "}",
        "",
        "static PyMethodDef Methods[] = {",
        '  {"pick", pick_wrap, METH_NOARGS, NULL},',
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
    const libAPosix = libARel.replace(/\\/g, "/");
    const libBPosix = libBRel.replace(/\\/g, "/");
    const libALabel = `//${libAPosix}:a`;
    const libBLabel = `//${libBPosix}:b`;
    const extLabel = `//${relPosix}:ext`;

    await fs.mkdirp(path.join(tmp, "tools", "buck"));
    await fs.writeFile(
      path.join(tmp, "tools", "buck", "graph.json"),
      JSON.stringify(
        [
          {
            name: libALabel,
            rule_type: "cxx_library",
            labels: ["lang:cpp", "kind:lib"],
            srcs: [`${libAPosix}/src/pick.cc`],
            deps: [],
            link_deps: [],
            header_deps: [],
          },
          {
            name: libBLabel,
            rule_type: "cxx_library",
            labels: ["lang:cpp", "kind:lib"],
            srcs: [`${libBPosix}/src/pick.cc`],
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
            deps: [libALabel, libBLabel],
            link_deps: [libALabel, libBLabel],
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
    const drv2 = await nixEvalSelectedDrvPath(tmp, $, extLabel);
    assert.equal(drv1, drv2, "expected identical drvPath across repeated evals");
  });
});
