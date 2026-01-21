#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
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
      BUCK_TARGET: target,
      WORKSPACE_ROOT: tmp,
      BUCK_TEST_SRC: tmp,
      PY_WASM_BACKEND: "pyodide",
      NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
        hello: { version: "1.0.0", originPath: "apps/pywasm/vendor/hello" },
      }),
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

test("python wasm (pyodide): app includes extension overlay", async () => {
  await runInTemp("py-wasm-pyodide-ext-app", async (tmp, $) => {
    const appRel = path.join("apps", "pywasm");
    const appDir = path.join(tmp, appRel);
    await fs.mkdir(path.join(appDir, "bin"), { recursive: true });
    await fs.mkdir(path.join(appDir, "src", "demo"), { recursive: true });
    await fs.mkdir(path.join(appDir, "native"), { recursive: true });

    await fs.writeFile(path.join(appDir, "src", "demo", "__init__.py"), "", "utf8");
    await fs.writeFile(path.join(appDir, "bin", "__main__.py"), 'print("ok")\n', "utf8");
    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["[[package]]", 'name = "hello"', 'version = "1.0.0"'].join("\n") + "\n",
      "utf8",
    );
    const vendor = path.join(appDir, "vendor", "hello");
    await fs.mkdir(path.join(vendor, "hello"), { recursive: true });
    await fs.writeFile(path.join(vendor, "hello", "__init__.py"), 'VALUE="one"\n', "utf8");

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

    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      `
load("//python:defs.bzl", "nix_python_wasm_app", "nix_python_wasm_extension_module")

nix_python_wasm_extension_module(
  name = "ext",
  module = "demo._native",
  srcs = ["native/ext.c"],
  labels = ["backend:pyodide"],
  lockfile_label = "lockfile:apps/pywasm/uv.lock#apps/pywasm",
)

nix_python_wasm_app(
  name = "pyapp",
  labels = ["backend:pyodide"],
  lockfile_label = "lockfile:apps/pywasm/uv.lock#apps/pywasm",
  srcs = glob(["**/*.py"]),
  deps = [":ext"],
)
`,
      "utf8",
    );

    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    const outPath = await nixBuildSelected(tmp, $, "//apps/pywasm:pyapp");
    const outDir = path.join(outPath, "site", "demo");
    const entries = await fs.readdir(outDir);
    const hit = entries.find((entry) => entry.startsWith("_native") && entry.endsWith(".so"));
    assert.ok(hit, `expected extension under ${outDir}, got: ${entries.join(", ")}`);

    const runJs = path.join(outPath, "bin", "run.mjs");
    const runOut = await $`node ${runJs}`;
    assert.match(String(runOut.stdout || ""), /nativeOverlays=1/);
  });
});
