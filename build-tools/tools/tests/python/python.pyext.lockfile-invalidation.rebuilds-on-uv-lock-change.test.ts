#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function nixEvalPyExtAndControlDrvPaths(
  tmp: string,
  $: any,
  appPosix: string,
): Promise<{ pyext: string; control: string }> {
  const expr = `
    let
      pkgs = import <nixpkgs> {};
      pyExt = import ./viberoots/build-tools/tools/nix/templates/python/pyext.nix { inherit pkgs; };
      py = pyExt {
        name = "//${appPosix}:ext";
        module = "demo._native";
        lockfile = "${appPosix}/uv.lock";
        srcRoot = ./.;
        subdir = "${appPosix}";
        srcList = [ "${appPosix}/native/ext.cpp" ];
        cflags = [];
        ldflags = [];
        nixCxxAttrs = [];
        buildPyDeps = [];
        repoCxxPkgs = [];
        includeRoots = [];
      };
      control = pkgs.runCommand "pyext-lockfile-control" {} ''
        mkdir -p "$out"
        echo ok > "$out/control.txt"
      '';
    in {
      pyext = py.drvPath;
      control = control.drvPath;
    }
  `;
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`nix eval --impure --expr ${expr} --json`;
  if (res.exitCode !== 0) {
    console.error(String(res.stderr || ""));
    throw new Error(`nix eval failed (exit=${res.exitCode})`);
  }
  const parsed = JSON.parse(String(res.stdout || "{}")) as { pyext?: unknown; control?: unknown };
  const pyext = String(parsed.pyext || "");
  const control = String(parsed.control || "");
  assert.ok(pyext.startsWith("/nix/store/"), `expected pyext drvPath, got: ${pyext}`);
  assert.ok(pyext.endsWith(".drv"), `expected pyext drvPath, got: ${pyext}`);
  assert.ok(control.startsWith("/nix/store/"), `expected control drvPath, got: ${control}`);
  assert.ok(control.endsWith(".drv"), `expected control drvPath, got: ${control}`);
  return { pyext, control };
}

test("python: pyext rebuilds when uv.lock changes with empty build_py_deps", async () => {
  await runInTemp("python-pyext-lockfile-invalidation", async (tmp, $) => {
    const appRel = path.join("projects", "apps", "pyext_lockfile");
    const appDir = path.join(tmp, appRel);

    await fs.mkdirp(path.join(appDir, "native"));

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

    const first = await nixEvalPyExtAndControlDrvPaths(tmp, $, appPosix);

    await fs.appendFile(path.join(appDir, "uv.lock"), "\n# changed\n", "utf8");

    const second = await nixEvalPyExtAndControlDrvPaths(tmp, $, appPosix);

    assert.notEqual(
      first.pyext,
      second.pyext,
      "expected pyext drvPath to change after uv.lock edit",
    );
    assert.equal(first.control, second.control, "expected control drvPath to remain cached");
  });
});
