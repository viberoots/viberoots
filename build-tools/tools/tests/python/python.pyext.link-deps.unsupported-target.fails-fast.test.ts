#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python: pyext link_deps rejects unsupported targets with a targeted error", async () => {
  await runInTemp("python-pyext-link-deps-unsupported", async (tmp, $) => {
    const appRel = path.join("apps", "pyext_bad_link_dep");
    const appDir = path.join(tmp, appRel);

    await fs.mkdirp(path.join(appDir, "bin"));
    await fs.mkdirp(path.join(appDir, "src", "demo"));
    await fs.mkdirp(path.join(appDir, "native"));

    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(path.join(appDir, "src", "demo", "__init__.py"), "", "utf8");
    await fs.writeFile(
      path.join(appDir, "bin", "__main__.py"),
      ["import demo._native as n", "print(n.noop())", ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(appDir, "native", "ext.c"),
      [
        "#include <Python.h>",
        "",
        "static PyObject* noop(PyObject* self, PyObject* args) {",
        "  return PyLong_FromLong(1);",
        "}",
        "",
        "static PyMethodDef Methods[] = {",
        '  {"noop", noop, METH_VARARGS, NULL},',
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
    const badDep = `//${relPosix}:not_cpp`;

    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
    await fs.mkdirp(graphDir);
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: badDep,
            rule_type: "python_library",
            labels: ["lang:python", "kind:lib"],
            srcs: [`${relPosix}/src/demo/__init__.py`],
            deps: [],
          },
          {
            name: extLabel,
            rule_type: "python_pyext_stub",
            labels: ["lang:python", "kind:pyext"],
            module: "demo._native",
            srcs: [`${relPosix}/native/ext.c`],
            deps: [badDep],
            link_deps: [badDep],
            header_deps: [],
            link_closure: "direct",
            link_closure_overrides: {},
            cflags: [],
            ldflags: [],
            build_py_deps: [],
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

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        BUCK_TEST_SRC: tmp,
        BUCK_TARGET: binLabel,
      },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;

    assert.notEqual(res.exitCode, 0, "expected nix build to fail");
    const stderr = String(res.stderr || "");
    assert.ok(
      stderr.includes("python planner: link_deps for") && stderr.includes("expected lang:cpp"),
      `expected targeted error mentioning lang:cpp, got:\n${stderr}`,
    );
  });
});
