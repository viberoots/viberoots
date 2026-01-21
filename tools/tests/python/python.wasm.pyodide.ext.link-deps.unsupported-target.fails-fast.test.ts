#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python wasm (pyodide): link_deps rejects unsupported targets with a targeted error", async () => {
  await runInTemp("py-wasm-pyodide-ext-link-unsupported", async (tmp, $) => {
    const appRel = path.join("apps", "pyext_wasm_bad_link_dep");
    const appDir = path.join(tmp, appRel);

    await fs.mkdirp(path.join(appDir, "native"));
    await fs.writeFile(
      path.join(appDir, "native", "ext.c"),
      [
        "#include <Python.h>",
        "",
        "static PyMethodDef Methods[] = {",
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
    const badDep = `//${relPosix}:not_wasm`;

    const graphDir = path.join(tmp, "tools", "buck");
    await fs.mkdirp(graphDir);
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: badDep,
            rule_type: "python_library",
            labels: ["lang:python", "kind:lib"],
            srcs: [],
            deps: [],
          },
          {
            name: extLabel,
            rule_type: "python_pyext_stub",
            labels: ["lang:python", "kind:pyext_wasm", "backend:pyodide"],
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
        BUCK_TARGET: extLabel,
      },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;

    assert.notEqual(res.exitCode, 0, "expected nix build to fail");
    const stderr = String(res.stderr || "");
    assert.ok(
      stderr.includes("python planner (pyext_wasm):") && stderr.includes("expected labels"),
      `expected targeted error mentioning supported labels, got:\n${stderr}`,
    );
  });
});
