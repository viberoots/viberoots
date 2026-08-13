#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";
import { writePyO3PyodideApp } from "./rust-pyodide-pyo3-fixture";

async function writeCargoRoot(root: string) {
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "Cargo.toml"),
    [
      "[package]",
      'name = "rust-python-wasm"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[lib]",
      'crate-type = ["cdylib"]',
      "",
    ].join("\n"),
  );
  await fs.writeFile(path.join(root, "Cargo.lock"), "# lock\n", "utf8");
  await fs.writeFile(
    path.join(root, "src", "lib.rs"),
    '#[no_mangle] pub extern "C" fn PyInit__native() {}\n',
    "utf8",
  );
  await fs.writeFile(path.join(root, "uv.lock"), "# uv lock\n", "utf8");
}

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
      PATH: `${path.join(tmp, "poison-bin")}:${process.env.PATH || ""}`,
      PY_WASM_BACKEND: "pyodide",
      NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
        builddep: {
          version: "1.0.0",
          originPath: "projects/apps/rust_pyodide_app/vendor/builddep",
        },
      }),
      AWS_SECRET_ACCESS_KEY: "poison",
      PIP_INDEX_URL: "https://poison.invalid/simple",
      PIP_REQUIRE_VIRTUALENV: "poison",
      PYTHONPATH: "poison",
      PYTHONHOME: "poison",
      HTTPS_PROXY: "poison",
      CC: "poison",
      CFLAGS: "poison",
      EMCC_CFLAGS: "poison",
      HOME: path.join(tmp, "poison"),
      CARGO_HOME: path.join(tmp, "poison", ".cargo"),
    },
  })`nix build --impure -L ${`path:${await workspaceFlakeRef(tmp)}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
  if (res.exitCode !== 0) {
    console.error(String(res.stderr || ""));
    throw new Error(`nix build failed (exit=${res.exitCode})`);
  }
  return (
    String(res.stdout || "")
      .trim()
      .split(/\n+/)
      .pop() || ""
  );
}

test("Rust Python WASM extension imports and executes in Pyodide", async () => {
  await runInTemp("rust-python-wasm-pyodide-import", async (tmp, $) => {
    const { appDir } = await writePyO3PyodideApp(tmp);
    await fs.mkdir(path.join(tmp, "poison-bin"), { recursive: true });
    for (const tool of ["cargo", "rustc", "emcc", "python", "python3", "cc"]) {
      const file = path.join(tmp, "poison-bin", tool);
      await fs.writeFile(file, "#!/bin/sh\necho poison tool >&2\nexit 99\n");
      await fs.chmod(file, 0o755);
    }
    await fs.mkdir(path.join(tmp, "poison", ".cargo"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "poison", ".cargo", "config.toml"),
      '[target.wasm32-unknown-emscripten]\nlinker = "poison-emcc"\n',
    );
    await fs.mkdir(path.join(tmp, "projects", "libs", "cpp_answer", "include"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmp, "projects", "libs", "cpp_answer", "answer.c"),
      "int linked_answer(void) { return 5; }\n",
    );
    await fs.writeFile(
      path.join(tmp, "projects", "libs", "cpp_answer", "include", "answer.h"),
      "int linked_answer(void);\n",
    );
    await fs.writeFile(
      path.join(tmp, "projects", "libs", "cpp_answer", "TARGETS"),
      `
load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_headers")
load("@viberoots//build-tools/cpp:wasm_defs.bzl", "nix_cpp_wasm_static_lib")
nix_cpp_headers(name = "headers", headers = ["include/answer.h"], visibility = ["PUBLIC"])
nix_cpp_wasm_static_lib(
  name = "static",
  srcs = ["answer.c"],
  header_deps = [":headers"],
  visibility = ["PUBLIC"],
)
`,
    );
    const rustLib = await fs.readFile(path.join(appDir, "src", "lib.rs"), "utf8");
    await fs.writeFile(
      path.join(appDir, "src", "lib.rs"),
      [
        'unsafe extern "C" { fn linked_answer() -> i32; }',
        rustLib.replace(
          "Ok(answer_dep::value())",
          "Ok(answer_dep::value() + unsafe { linked_answer() })",
        ),
      ].join("\n"),
    );
    await fs.mkdir(path.join(appDir, "native"), { recursive: true });
    await fs.writeFile(
      path.join(appDir, "native", "ext.c"),
      [
        "#include <Python.h>",
        "static PyObject* answer(PyObject* self, PyObject* args) { (void)self; (void)args; return PyLong_FromLong(7); }",
        'static PyMethodDef Methods[] = {{"answer", answer, METH_NOARGS, NULL}, {NULL, NULL, 0, NULL}};',
        'static struct PyModuleDef moduledef = {PyModuleDef_HEAD_INIT, "_native", NULL, -1, Methods};',
        "PyMODINIT_FUNC PyInit__native(void) { return PyModule_Create(&moduledef); }",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      `
load("@viberoots//build-tools/python:defs.bzl", "nix_python_wasm_app", "nix_python_wasm_extension_module")
load("@viberoots//build-tools/rust:defs.bzl", "rust_python_wasm_extension")

nix_python_wasm_extension_module(
  name = "c_ext",
  module = "demo._native",
  srcs = ["native/ext.c"],
  labels = ["backend:pyodide"],
  lockfile_label = "lockfile:projects/apps/rust_pyodide_app/uv.lock#projects/apps/rust_pyodide_app",
)

rust_python_wasm_extension(
  name = "rust_ext",
  backend = "pyodide",
  module = "demo._native",
  crate = "rust-pyodide-app",
  srcs = ["src/lib.rs"],
  link_deps = ["//projects/libs/cpp_answer:static"],
  header_deps = ["//projects/libs/cpp_answer:headers"],
  build_py_deps = ["builddep"],
  lockfile_label = "lockfile:projects/apps/rust_pyodide_app/uv.lock#projects/apps/rust_pyodide_app",
)

nix_python_wasm_app(
  name = "pyapp",
  labels = ["backend:pyodide"],
  lockfile_label = "lockfile:projects/apps/rust_pyodide_app/uv.lock#projects/apps/rust_pyodide_app",
  srcs = glob(["**/*.py"]),
  deps = [":c_ext", ":rust_ext"],
)
`,
    );
    await $({
      cwd: tmp,
    })`node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    const outPath = await nixBuildSelected(tmp, $, "//projects/apps/rust_pyodide_app:pyapp");
    const runOut = await $({
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`node ${path.join(outPath, "bin", "run.mjs")}`;
    if (runOut.exitCode !== 0) {
      throw new Error(
        `node Pyodide run failed with exit code ${runOut.exitCode}\nstdout:\n${String(runOut.stdout || "").slice(-4000)}\nstderr:\n${String(runOut.stderr || "").slice(-4000)}`,
      );
    }
    const stdout = String(runOut.stdout || "");
    assert.match(stdout, /RUST_VALUE=47/);
    assert.match(stdout, /RUST_ERROR=rust pyodide error/);
    const rustOut = await nixBuildSelected(tmp, $, "//projects/apps/rust_pyodide_app:rust_ext");
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(rustOut, "share/viberoots-rust/materialization-manifest.json"),
        "utf8",
      ),
    );
    assert.equal(manifest.artifacts.pyemscripten.kind, "pyext_wasm");
    assert.equal(manifest.artifacts.pyemscripten.module, "demo._native");
    assert.equal(manifest.artifacts.pyemscripten.modulePath, "demo/_native");
    assert.equal(manifest.artifacts.pyemscripten.requiredExport, "PyInit__native");
    assert.match(manifest.artifacts.pyemscripten.relativePath, /^site\/demo\/_native.*\.so$/);
    assert.match(
      manifest.tools.pyemscripten.pyo3Cross.configFile,
      /^\/nix\/store\/.*pyo3-pyodide-cross-config.txt$/,
    );
    await fs.stat(path.join(rustOut, manifest.artifacts.pyemscripten.relativePath));
  });
});

test("Rust Python WASM extensions keep WASI fail-closed", async () => {
  await runInTemp("rust-python-wasm-wasi-closed", async (tmp, $) => {
    const root = path.join(tmp, "projects/libs/rust_python_wasm_wasi");
    await writeCargoRoot(root);
    await fs.writeFile(
      path.join(root, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_python_wasm_extension")',
        'rust_python_wasm_extension(name="extension", backend="wasi", module="demo._native")',
        "",
      ].join("\n"),
    );
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery //projects/libs/rust_python_wasm_wasi:extension`;
    assert.notEqual(result.exitCode, 0);
    assert.match(
      `${String(result.stdout || "")}\n${String(result.stderr || "")}`,
      /shared Python WASI runtime cannot load kind:pyext_wasm/,
    );
  });
});
