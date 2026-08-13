#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";
import { writePyO3PyodideApp } from "./rust-pyodide-pyo3-fixture";

async function writeMinimalCargo(root: string) {
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "Cargo.toml"),
    "[package]\nname='rust-python-wasm'\nversion='0.1.0'\nedition='2021'\n[lib]\ncrate-type=['cdylib']\n",
  );
  await fs.writeFile(path.join(root, "Cargo.lock"), "version = 4\n");
  await fs.writeFile(
    path.join(root, "src", "lib.rs"),
    '#[no_mangle] pub extern "C" fn PyInit__native() {}\n',
  );
  await fs.writeFile(path.join(root, "uv.lock"), "# uv lock\n");
}

async function buildSelected(tmp: string, $: any, target: string) {
  return await $({
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
        builddep: {
          version: "1.0.0",
          originPath: "projects/apps/rust_pyodide_app/vendor/builddep",
        },
      }),
    },
  })`nix build --impure -L ${`path:${await workspaceFlakeRef(tmp)}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
}

test("Rust Pyodide macro rejects unknown args and exposes deterministic contract inputs", async () => {
  await runInTemp("rust-pyodide-contracts", async (tmp, $) => {
    const root = path.join(tmp, "projects/libs/rust_python_wasm");
    await writeMinimalCargo(root);
    await fs.mkdir(path.join(tmp, "projects/libs/wasm_inputs/include"), { recursive: true });
    await fs.writeFile(path.join(tmp, "projects/libs/wasm_inputs/include/a.h"), "int a(void);\n");
    await fs.writeFile(path.join(tmp, "projects/libs/wasm_inputs/include/b.h"), "int b(void);\n");
    await fs.writeFile(
      path.join(tmp, "projects/libs/wasm_inputs/a.c"),
      "int a(void) { return 1; }\n",
    );
    await fs.writeFile(
      path.join(tmp, "projects/libs/wasm_inputs/b.c"),
      "int b(void) { return 2; }\n",
    );
    await fs.writeFile(
      path.join(tmp, "projects/libs/wasm_inputs/TARGETS"),
      `
load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_headers")
load("@viberoots//build-tools/cpp:wasm_defs.bzl", "nix_cpp_wasm_static_lib")
nix_cpp_headers(name = "headers_a", headers = ["include/a.h"], visibility = ["PUBLIC"])
nix_cpp_headers(name = "headers_b", headers = ["include/b.h"], visibility = ["PUBLIC"])
nix_cpp_wasm_static_lib(name = "static_a", srcs = ["a.c"], header_deps = [":headers_a"], visibility = ["PUBLIC"])
nix_cpp_wasm_static_lib(name = "static_b", srcs = ["b.c"], header_deps = [":headers_b"], visibility = ["PUBLIC"])
`,
    );
    await fs.mkdir(path.join(root, "patches", "rust-pyodide"), { recursive: true });
    await fs.writeFile(
      path.join(root, "TARGETS"),
      `
load("@viberoots//build-tools/rust:defs.bzl", "rust_python_wasm_extension")
rust_python_wasm_extension(
  name = "extension",
  backend = "pyodide",
  module = "demo._native",
  lockfile_label = "lockfile:projects/libs/rust_python_wasm/uv.lock#projects/libs/rust_python_wasm",
  build_py_deps = ["builddep"],
  features = ["extension-module"],
  default_features = False,
  profile = "release",
  local_patch_dirs = ["patches/rust-pyodide"],
  link_deps = ["//projects/libs/wasm_inputs:static_b", "//projects/libs/wasm_inputs:static_a"],
  header_deps = ["//projects/libs/wasm_inputs:headers_b", "//projects/libs/wasm_inputs:headers_a"],
  srcs = ["src/lib.rs"],
)
`,
    );
    const attrs = [
      "cargo_manifest",
      "cargo_lock",
      "cargo_root",
      "crate_type",
      "features",
      "default_features",
      "profile",
      "target",
      "module",
      "build_py_deps",
      "local_patch_dirs",
      "link_deps",
      "header_deps",
      "nix_inputs",
      "srcs",
      "labels",
    ];
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --json ${attrs.flatMap((a) => ["--output-attribute", a])} //projects/libs/rust_python_wasm:extension`;
    const node = Object.values(JSON.parse(String(result.stdout || "{}")))[0] as any;
    const configured = (labels: string[]) =>
      labels.map((label) => label.replace(/ \(<[^)]*>\)$/, ""));
    assert.equal(node.cargo_manifest, "root//projects/libs/rust_python_wasm/Cargo.toml");
    assert.equal(node.cargo_lock, "root//projects/libs/rust_python_wasm/Cargo.lock");
    assert.equal(node.cargo_root, "projects/libs/rust_python_wasm");
    assert.equal(node.crate_type, "cdylib");
    assert.deepEqual(node.features, ["extension-module"]);
    assert.equal(node.default_features, false);
    assert.equal(node.profile, "release");
    assert.equal(node.target, "wasm32-unknown-emscripten");
    assert.equal(node.module, "demo._native");
    assert.deepEqual(node.build_py_deps, ["builddep"]);
    assert.deepEqual(node.local_patch_dirs, ["patches/rust-pyodide"]);
    assert.deepEqual(configured(node.link_deps), [
      "root//projects/libs/wasm_inputs:static_b",
      "root//projects/libs/wasm_inputs:static_a",
    ]);
    assert.deepEqual(configured(node.header_deps), [
      "root//projects/libs/wasm_inputs:headers_b",
      "root//projects/libs/wasm_inputs:headers_a",
    ]);
    assert.ok(node.srcs.includes("root//projects/libs/rust_python_wasm/src/lib.rs"));
    assert.ok(String(node.nix_inputs).includes(".viberoots/workspace:flake.nix"));
    assert.ok(String(node.nix_inputs).includes(".viberoots/workspace:flake.lock"));
    assert.ok(node.labels.includes("kind:pyext_wasm"));
    assert.ok(node.labels.includes("backend:pyodide"));

    await fs.writeFile(
      path.join(root, "TARGETS"),
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_python_wasm_extension")\nrust_python_wasm_extension(name="bad", backend="pyodide", module="demo._native", mystery=True)\n',
    );
    const bad = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery //projects/libs/rust_python_wasm:bad`;
    assert.notEqual(bad.exitCode, 0);
    assert.match(
      `${bad.stdout}\n${bad.stderr}`,
      /rust_python_wasm_extension: unknown arguments: mystery/,
    );

    await fs.writeFile(
      path.join(root, "TARGETS"),
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_python_wasm_extension")\nrust_python_wasm_extension(name="bad_backend", backend="browser", module="demo._native")\n',
    );
    const badBackend = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery //projects/libs/rust_python_wasm:bad_backend`;
    assert.notEqual(badBackend.exitCode, 0);
    assert.match(`${badBackend.stdout}\n${badBackend.stderr}`, /unsupported backend/);

    await fs.writeFile(
      path.join(root, "TARGETS"),
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_python_wasm_extension")\nrust_python_wasm_extension(name="bad_crate_type", backend="pyodide", module="demo._native", crate_type="rlib")\n',
    );
    const badCrateType = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery //projects/libs/rust_python_wasm:bad_crate_type`;
    assert.notEqual(badCrateType.exitCode, 0);
    assert.match(`${badCrateType.stdout}\n${badCrateType.stderr}`, /crate_type must be cdylib/);
  });
});

test("Rust Pyodide builder rejects PyO3 ABI drift before publication", async () => {
  await runInTemp("rust-pyodide-abi-drift", async (tmp, $) => {
    const { appDir } = await writePyO3PyodideApp(tmp);
    const lib = await fs.readFile(path.join(appDir, "src", "lib.rs"), "utf8");
    await fs.writeFile(
      path.join(appDir, "src", "lib.rs"),
      lib.replace("fn _native", "fn wrong_native"),
    );
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      'load("@viberoots//build-tools/python:defs.bzl", "nix_python_wasm_app")\nload("@viberoots//build-tools/rust:defs.bzl", "rust_python_wasm_extension")\nrust_python_wasm_extension(name="rust_ext", backend="pyodide", module="demo._native", crate="rust-pyodide-app", srcs=["src/lib.rs"], build_py_deps=["builddep"], lockfile_label="lockfile:projects/apps/rust_pyodide_app/uv.lock#projects/apps/rust_pyodide_app")\nnix_python_wasm_app(name="pyapp", labels=["backend:pyodide"], lockfile_label="lockfile:projects/apps/rust_pyodide_app/uv.lock#projects/apps/rust_pyodide_app", srcs=glob(["**/*.py"]), deps=[":rust_ext"])\n',
    );
    await $({
      cwd: tmp,
    })`node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    const failed = await buildSelected(tmp, $, "//projects/apps/rust_pyodide_app:pyapp");
    assert.notEqual(failed.exitCode, 0);
    assert.match(String(failed.stderr || ""), /missing PyInit__native export/);
  });
});

test("Rust Pyodide builder rejects unexpected exports before publication", async () => {
  await runInTemp("rust-pyodide-unexpected-export", async (tmp, $) => {
    const { appDir } = await writePyO3PyodideApp(tmp);
    await fs.writeFile(
      path.join(appDir, "src", "lib.rs"),
      (await fs.readFile(path.join(appDir, "src", "lib.rs"), "utf8")) +
        '\n#[no_mangle]\npub extern "C" fn stray_export() -> i32 { 1 }\n',
    );
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      'load("@viberoots//build-tools/python:defs.bzl", "nix_python_wasm_app")\nload("@viberoots//build-tools/rust:defs.bzl", "rust_python_wasm_extension")\nrust_python_wasm_extension(name="rust_ext", backend="pyodide", module="demo._native", crate="rust-pyodide-app", srcs=["src/lib.rs"], build_py_deps=["builddep"], lockfile_label="lockfile:projects/apps/rust_pyodide_app/uv.lock#projects/apps/rust_pyodide_app")\nnix_python_wasm_app(name="pyapp", labels=["backend:pyodide"], lockfile_label="lockfile:projects/apps/rust_pyodide_app/uv.lock#projects/apps/rust_pyodide_app", srcs=glob(["**/*.py"]), deps=[":rust_ext"])\n',
    );
    await $({
      cwd: tmp,
    })`node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    const failed = await buildSelected(tmp, $, "//projects/apps/rust_pyodide_app:pyapp");
    assert.notEqual(failed.exitCode, 0);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /unexpected public exports:.*stray_export/);
  });
});
