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

test("python: planner-built pyApp can import an in-repo pyext module", async () => {
  await runInTemp("python-pyext-pyapp-import", async (tmp, $) => {
    const appRel = path.join("projects", "apps", "pyext_app");
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
      ["import demo._native as n", "print(n.add(2, 3))", ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(appDir, "native", "ext.c"),
      [
        "#include <Python.h>",
        "",
        "static PyObject* add(PyObject* self, PyObject* args) {",
        "  int a = 0;",
        "  int b = 0;",
        '  if (!PyArg_ParseTuple(args, "ii", &a, &b)) {',
        "    return NULL;",
        "  }",
        "  return PyLong_FromLong((long)(a + b));",
        "}",
        "",
        "static PyMethodDef Methods[] = {",
        '  {"add", add, METH_VARARGS, NULL},',
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

    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
    await fs.mkdirp(graphDir);
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: `//${appRel.replace(/\\/g, "/")}:ext`,
            rule_type: "python_pyext_stub",
            labels: ["lang:python", "kind:pyext"],
            module: "demo._native",
            srcs: [`${appRel.replace(/\\/g, "/")}/native/ext.c`],
            deps: [],
            cflags: [],
            ldflags: [],
          },
          {
            name: `//${appRel.replace(/\\/g, "/")}:app`,
            rule_type: "python_binary",
            labels: ["lang:python", "kind:bin"],
            srcs: [`${appRel.replace(/\\/g, "/")}/bin/__main__.py`],
            deps: [`//${appRel.replace(/\\/g, "/")}:ext`],
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const outPath = await nixBuildSelected(tmp, $, `//${appRel.replace(/\\/g, "/")}:app`);
    const binDir = path.join(outPath, "bin");
    const bins = (await fs.readdir(binDir)).filter(Boolean);
    assert.ok(bins.length >= 1, `expected at least one wrapper in ${binDir}`);

    const wrapper = path.join(binDir, bins[0]!);
    const run = await $({ cwd: tmp, stdio: "pipe", reject: false, nothrow: true })`${wrapper}`;
    assert.equal(run.exitCode, 0, String(run.stderr || ""));
    assert.equal(String(run.stdout || "").trim(), "5");
  });
});
