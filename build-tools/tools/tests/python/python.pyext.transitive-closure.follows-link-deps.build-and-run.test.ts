#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

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

test("python: pyext transitive link_closure follows link_deps on producers (build + run)", async () => {
  await runInTemp("python-pyext-link-closure-transitive", async (tmp, $) => {
    const appRel = path.join("apps", "pyext_link_transitive");
    const appDir = path.join(tmp, appRel);
    const supportRel = path.join("libs", "cpp_support");
    const supportDir = path.join(tmp, supportRel);
    const coreRel = path.join("libs", "cpp_core");
    const coreDir = path.join(tmp, coreRel);

    await fs.mkdirp(path.join(appDir, "bin"));
    await fs.mkdirp(path.join(appDir, "src", "demo"));
    await fs.mkdirp(path.join(appDir, "native"));
    await fs.mkdirp(path.join(supportDir, "src"));
    await fs.mkdirp(path.join(coreDir, "src"));

    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(path.join(appDir, "src", "demo", "__init__.py"), "", "utf8");
    await fs.writeFile(
      path.join(appDir, "bin", "__main__.py"),
      ["import demo._native as n", "print(n.run(10, 2))", ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(supportDir, "src", "support.cc"),
      ['extern "C" int support_add(int a, int b) { return a + b; }', ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(coreDir, "src", "core.cc"),
      [
        'extern "C" int support_add(int a, int b);',
        'extern "C" int core_add(int a, int b) { return support_add(a, b) + 1; }',
        "",
      ].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(appDir, "native", "ext.cpp"),
      [
        "#include <Python.h>",
        "",
        'extern "C" int core_add(int a, int b);',
        "",
        "static PyObject* run_wrap(PyObject* self, PyObject* args) {",
        "  int a = 0;",
        "  int b = 0;",
        '  if (!PyArg_ParseTuple(args, "ii", &a, &b)) {',
        "    return NULL;",
        "  }",
        "  return PyLong_FromLong((long)core_add(a, b));",
        "}",
        "",
        "static PyMethodDef Methods[] = {",
        '  {"run", run_wrap, METH_VARARGS, NULL},',
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
    const supportPosix = supportRel.replace(/\\/g, "/");
    const corePosix = coreRel.replace(/\\/g, "/");
    const supportLabel = `//${supportPosix}:support`;
    const coreLabel = `//${corePosix}:core`;
    const extLabel = `//${relPosix}:ext`;
    const binLabel = `//${relPosix}:app`;

    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
    await fs.mkdirp(graphDir);
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: supportLabel,
            rule_type: "cxx_library",
            labels: ["lang:cpp", "kind:lib"],
            srcs: [`${supportPosix}/src/support.cc`],
            deps: [],
            link_deps: [],
            header_deps: [],
          },
          {
            name: coreLabel,
            rule_type: "cxx_library",
            labels: ["lang:cpp", "kind:lib"],
            srcs: [`${corePosix}/src/core.cc`],
            deps: [supportLabel],
            link_deps: [supportLabel],
            header_deps: [],
          },
          {
            name: extLabel,
            rule_type: "python_pyext_stub",
            labels: ["lang:python", "kind:pyext"],
            module: "demo._native",
            srcs: [`${relPosix}/native/ext.cpp`],
            deps: [coreLabel],
            link_deps: [coreLabel],
            header_deps: [],
            link_closure: "transitive",
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
    assert.equal(String(run.stdout || "").trim(), "13");
  });
});
