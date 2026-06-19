#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

async function nixBuild(
  tmp: string,
  $: any,
  attr: string,
  env?: Record<string, string>,
): Promise<string> {
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
    env: {
      ...process.env,
      ...env,
    },
  })`nix build --impure -L ${`path:${await workspaceFlakeRef(tmp)}#${attr}`} --accept-flake-config --no-link --print-out-paths`;
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

test("python: pyext_wasm (wasi) uses pinned toolchain ext suffix", async () => {
  await runInTemp("python-pyext-wasm-wasi-ext-suffix", async (tmp, $) => {
    const appRel = path.join("projects", "apps", "pyext_wasm_wasi_suffix");
    const appDir = path.join(tmp, appRel);
    await fs.mkdirp(path.join(appDir, "native"));
    await fs.mkdirp(path.join(appDir, "src", "demo"));
    await fs.writeFile(path.join(appDir, "src", "demo", "__init__.py"), "", "utf8");
    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );
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
    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fs.mkdirp(graphDir);
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: extLabel,
            rule_type: "python_pyext_stub",
            labels: ["lang:python", "kind:pyext_wasm", "backend:wasi"],
            module: "demo._native",
            srcs: [`${relPosix}/native/ext.c`],
            deps: [],
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

    const outPath = await nixBuild(tmp, $, "graph-generator-selected", {
      BUCK_TARGET: extLabel,
      WORKSPACE_ROOT: tmp,
      BUCK_TEST_SRC: tmp,
      PY_WASM_BACKEND: "wasi",
    });
    const toolchainPath = await nixBuild(tmp, $, "py-wasi-toolchain");
    const extSuffix = (
      await fs.readFile(path.join(toolchainPath, "config", "ext-suffix.txt"), "utf8")
    ).trim();
    assert.ok(extSuffix.length > 0, "expected non-empty ext suffix from toolchain");

    const outDir = path.join(outPath, "site", "demo");
    const entries = (await fs.readdir(outDir)).filter(Boolean);
    const expected = `_native${extSuffix}`;
    assert.ok(
      entries.includes(expected),
      `expected ${expected} under ${outDir}, got: ${entries.join(", ")}`,
    );
  });
});
