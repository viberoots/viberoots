#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
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
      BUCK_TEST_SRC: tmp,
      BUCK_TARGET: target,
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

test("python: pyext links an in-repo C++ library via link_deps (build + run)", async () => {
  await runInTemp("python-pyext-link-cpp-lib", async (tmp, $) => {
    const appRel = path.join("projects", "apps", "pyext_link_cpp");
    const appDir = path.join(tmp, appRel);
    const libRel = path.join("projects", "libs", "cpp_math");
    const libDir = path.join(tmp, libRel);

    await fs.mkdirp(path.join(appDir, "bin"));
    await fs.mkdirp(path.join(appDir, "src", "demo"));
    await fs.mkdirp(path.join(appDir, "native"));
    await fs.mkdirp(path.join(libDir, "src"));

    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(path.join(appDir, "src", "demo", "__init__.py"), "", "utf8");
    await fs.writeFile(
      path.join(appDir, "bin", "__main__.py"),
      ["import demo._native as n", "print(n.add(2, 3))", ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(libDir, "src", "add.cc"),
      ['extern "C" int add(int a, int b) { return a + b; }', ""].join("\n"),
      "utf8",
    );

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
    const binLabel = `//${relPosix}:app`;

    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fs.mkdirp(graphDir);
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: libLabel,
            rule_type: "cxx_library",
            labels: ["lang:cpp", "kind:lib"],
            srcs: [`${libPosix}/src/add.cc`],
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
    const run = await $({ cwd: tmp, stdio: "pipe", reject: false, nothrow: true })`${wrapper}`;
    assert.equal(run.exitCode, 0, String(run.stderr || ""));
    assert.equal(String(run.stdout || "").trim(), "5");
  });
});
