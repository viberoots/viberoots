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

test("python: pyext rebuilds when uv.lock changes with empty build_py_deps", async () => {
  await runInTemp("python-pyext-lockfile-invalidation", async (tmp, $) => {
    const appRel = path.join("projects", "apps", "pyext_lockfile");
    const appDir = path.join(tmp, appRel);
    const libRel = path.join("projects", "libs", "math");
    const libDir = path.join(tmp, libRel);

    await fs.mkdirp(path.join(appDir, "native"));
    await fs.mkdirp(path.join(libDir, "src"));

    await fs.writeFile(
      path.join(libDir, "src", "noop.cc"),
      ['extern "C" int noop() { return 0; }', ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(appDir, "native", "ext.cpp"),
      [
        "#include <Python.h>",
        "",
        "static PyObject* value(PyObject* self, PyObject* args) {",
        "  return PyLong_FromLong(1);",
        "}",
        "",
        "static PyMethodDef Methods[] = {",
        '  {"value", value, METH_NOARGS, NULL},',
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
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );

    const appPosix = appRel.replace(/\\/g, "/");
    const libPosix = libRel.replace(/\\/g, "/");
    const extLabel = `//${appPosix}:ext`;
    const libLabel = `//${libPosix}:noop`;

    await fs.mkdirp(path.join(tmp, "build-tools", "tools", "buck"));
    await fs.writeFile(
      path.join(tmp, "build-tools", "tools", "buck", "graph.json"),
      JSON.stringify(
        [
          {
            name: libLabel,
            rule_type: "cxx_library",
            labels: ["lang:cpp", "kind:lib"],
            srcs: [`${libPosix}/src/noop.cc`],
            deps: [],
            link_deps: [],
            header_deps: [],
          },
          {
            name: extLabel,
            rule_type: "python_pyext_stub",
            labels: ["lang:python", "kind:pyext"],
            module: "demo._native",
            srcs: [`${appPosix}/native/ext.cpp`],
            deps: [],
            link_deps: [],
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

    const pyextDrv1 = await nixEvalSelectedDrvPath(tmp, $, extLabel);
    const controlDrv1 = await nixEvalSelectedDrvPath(tmp, $, libLabel);

    await fs.appendFile(path.join(appDir, "uv.lock"), "\n# changed\n", "utf8");

    const pyextDrv2 = await nixEvalSelectedDrvPath(tmp, $, extLabel);
    const controlDrv2 = await nixEvalSelectedDrvPath(tmp, $, libLabel);

    assert.notEqual(pyextDrv1, pyextDrv2, "expected pyext drvPath to change after uv.lock edit");
    assert.equal(controlDrv1, controlDrv2, "expected control drvPath to remain cached");
  });
});
