#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import {
  assertBehaviorProbeCqueryContract,
  firstCqueryNode,
} from "./rust-behavior-probe-cquery-contract";
import {
  assertRustNixRuleKinds,
  assertWasmCqueryContract,
  wasmDeclarations,
  writeWasmContractFiles,
} from "./rust-wasm-cquery-fixture";

test("rust macros export native build, test, and source-selection contracts", async () => {
  await runInTemp("rust-nix-build-rule-types", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "rustapp");
    await fs.mkdirp(path.join(appDir, "src"));
    await fs.writeFile(
      path.join(appDir, "src", "lib.rs"),
      "pub fn add(a:i32,b:i32)->i32{a+b}\n",
      "utf8",
    );
    await fs.writeFile(path.join(appDir, "src", "main.rs"), "fn main(){}\n", "utf8");
    await writeWasmContractFiles(appDir);
    await fs.writeFile(
      path.join(appDir, "Cargo.toml"),
      '[package]\nname="rustapp"\nversion="0.1.0"\nedition="2021"\n',
    );
    await fs.writeFile(
      path.join(appDir, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname = "rustapp"\nversion = "0.1.0"\n',
    );
    await fs.writeFile(path.join(appDir, "uv.lock"), "version = 1\n");
    await fs.mkdirp(path.join(appDir, "patches", "rust"));
    await fs.writeFile(
      path.join(appDir, "patches", "rust", "demo.patch"),
      "diff --git a/src/lib.rs b/src/lib.rs\n",
    );
    await fs.mkdirp(path.join(appDir, "patches", "python"));
    await fs.writeFile(
      path.join(appDir, "patches", "python", "build-dep.patch"),
      "fixture python patch input\n",
    );
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary", "rust_cdylib", "rust_library", "rust_node_addon", "rust_proc_macro", "rust_python_extension", "rust_static_library", "rust_test", "rust_wasi_binary", "rust_wasm_browser_package", "rust_wasm_component", "rust_wasm_library", "rust_wasm_static_library")',
        "",
        'rust_library(name = "lib", crate = "rustapp", behavior_probe = True, cargo_output_hashes = {"remote-1.0.0": "sha256-fixture"}, cargo_fixed_sources = {"remote@1.0.0#registry+https://registry.example/index": "{\\"source\\":\\"registry+https://registry.example/index\\"}"}, features = ["demo"], default_features = False, nixpkg_deps = ["pkgs.zlib"], nixpkgs_profile = "default", nixpkg_pins = {"pkgs.zlib": {"nixpkgs_profile": "default", "rationale": "fixture"}}, srcs = ["src/lib.rs"])',
        'rust_binary(name = "app", crate = "rustapp", behavior_probe = True, srcs = ["src/main.rs"], deps = [":lib"])',
        'rust_test(name = "test", crate = "rustapp", behavior_probe = True, srcs = ["src/lib.rs"])',
        'rust_wasm_library(name = "raw", crate = "rustapp", behavior_probe = True, srcs = ["src/lib.rs"])',
        'rust_wasi_binary(name = "wasi", crate = "rustapp", behavior_probe = True, srcs = ["src/main.rs"])',
        ...wasmDeclarations,
        'rust_static_library(name = "static", crate = "rustapp", public_crate = "rust_public", behavior_probe = True, srcs = ["src/lib.rs"])',
        'rust_cdylib(name = "dynamic", crate = "rustapp", behavior_probe = True, srcs = ["src/lib.rs"])',
        'rust_proc_macro(name = "derive_demo", crate = "rustapp", behavior_probe = True, generated_outputs = ["generated.rs"], srcs = ["src/lib.rs"])',
        'rust_python_extension(name = "pyext", module = "demo._native", crate = "rustapp", behavior_probe = True, build_py_deps = ["setuptools"], lockfile_label = "lockfile:projects/apps/rustapp/uv.lock#projects/apps/rustapp", srcs = ["src/lib.rs"])',
        'rust_node_addon(name = "addon", addon_name = "demo_native", node_api_version = 8, crate = "rustapp", behavior_probe = True, srcs = ["src/lib.rs"])',
        "",
      ].join("\n"),
      "utf8",
    );

    const libProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo "kind(rust_nix_build, //projects/apps/rustapp:lib)"`;
    assert.ok(
      String(libProbe.stdout || "").includes("//projects/apps/rustapp:lib"),
      String(libProbe.stderr || libProbe.stdout),
    );

    const binProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo "kind(rust_nix_build, //projects/apps/rustapp:app)"`;
    assert.ok(String(binProbe.stdout || "").includes("//projects/apps/rustapp:app"));

    const genruleProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo "kind(genrule, //projects/apps/rustapp:lib)"`;
    assert.equal(String(genruleProbe.stdout || "").trim(), "");

    await assertRustNixRuleKinds($);
    await assertWasmCqueryContract(tmp, $);
    await assertBehaviorProbeCqueryContract($);

    const extensionFields = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute module --output-attribute python_abi --output-attribute build_py_deps --output-attribute addon_name --output-attribute node_api_version --output-attribute platform --output-attribute labels "set(//projects/apps/rustapp:pyext //projects/apps/rustapp:addon)"`;
    const extensionContract = String(extensionFields.stdout);
    for (const expected of [
      "demo._native",
      "selected",
      "setuptools",
      "demo_native",
      "kind:pyext",
      "kind:addon",
      "lockfile:projects/apps/rustapp/uv.lock#projects/apps/rustapp",
    ]) {
      assert.ok(extensionContract.includes(expected), `missing extension field ${expected}`);
    }

    const crossCellExample = await $({ cwd: tmp, stdio: "pipe" })`
      buck2 cquery --target-platforms //:no_cgo viberoots//build-tools/tools/nix/examples/rust/native-example:lib
    `;
    assert.match(String(crossCellExample.stdout || ""), /native-example:lib/);

    const fields = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cargo_manifest --output-attribute cargo_lock --output-attribute cargo_root --output-attribute cargo_package --output-attribute cargo_lock_identity --output-attribute cargo_output_hashes --output-attribute cargo_fixed_sources --output-attribute crate --output-attribute public_crate --output-attribute crate_type --output-attribute host_role --output-attribute generated_outputs --output-attribute features --output-attribute default_features --output-attribute profile --output-attribute target --output-attribute local_patch_dirs --output-attribute nixpkgs_profile --output-attribute nixpkg_pins --output-attribute deps --output-attribute srcs --output-attribute labels //projects/apps/rustapp:lib`;
    const serialized = String(fields.stdout || "");
    for (const expected of [
      "Cargo.toml",
      "Cargo.lock",
      "rustapp",
      "demo",
      "patches/rust",
      "src/lib.rs",
    ]) {
      assert.ok(serialized.includes(expected), `missing exported Rust field/input ${expected}`);
    }
    const node = firstCqueryNode<{
      default_features?: boolean;
      labels?: string[];
      local_patch_dirs?: string[];
      nixpkgs_profile?: string;
      nixpkg_pins?: Record<string, unknown>;
      cargo_output_hashes?: Record<string, string>;
      cargo_fixed_sources?: Record<string, string>;
      srcs?: string[];
    }>(JSON.parse(serialized));
    assert.equal(node?.default_features, false);
    assert.equal(node?.nixpkgs_profile, "default");
    assert.ok(node?.nixpkg_pins?.["pkgs.zlib"]);
    assert.equal(node?.cargo_output_hashes?.["remote-1.0.0"], "sha256-fixture");
    assert.equal(
      node?.cargo_fixed_sources?.["remote@1.0.0#registry+https://registry.example/index"],
      '{"source":"registry+https://registry.example/index"}',
    );
    assert.deepEqual(node?.local_patch_dirs, ["patches/rust"]);
    assert.ok(node?.labels?.includes("patch_scope:package-local"));
    assert.ok(node?.labels?.includes("crate-type:rlib"));
    assert.ok(node?.labels?.includes("rust-role:target"));
    assert.ok(node?.labels?.includes("nixpkg:pkgs.zlib"));
    assert.ok(
      node?.srcs?.some((source) => String(source).endsWith("patches/rust/demo.patch")),
      `real Rust patch file is not a declared action input: ${JSON.stringify(node?.srcs)}`,
    );

    const artifactFields = await $({ cwd: tmp, stdio: "pipe" })`
      buck2 cquery --target-platforms //:no_cgo --json \
        --output-attribute crate_type --output-attribute public_crate \
        --output-attribute host_role --output-attribute generated_outputs \
        "set(//projects/apps/rustapp:static //projects/apps/rustapp:dynamic //projects/apps/rustapp:derive_demo)"
    `;
    const artifactJson = String(artifactFields.stdout || "");
    for (const expected of [
      "staticlib",
      "cdylib",
      "proc-macro",
      "rust_public",
      "generated.rs",
      "host",
    ]) {
      assert.match(artifactJson, new RegExp(expected));
    }
    const invalidDir = path.join(tmp, "projects", "apps", "invalid-addon");
    await fs.mkdirp(path.join(invalidDir, "src"));
    await fs.writeFile(path.join(invalidDir, "Cargo.toml"), '[package]\nname="invalid"\n');
    await fs.writeFile(
      path.join(invalidDir, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname = "invalid"\nversion = "0.1.0"\n',
    );
    await fs.writeFile(path.join(invalidDir, "src/lib.rs"), "");
    for (const [declaration, expected] of [
      [
        'rust_node_addon(name="addon", addon_name="../escape", crate="invalid")',
        "addon_name must match",
      ],
      [
        'rust_node_addon(name="addon", addon_name="valid", node_api_version=999, crate="invalid")',
        "node_api_version must be one of",
      ],
      [
        'rust_binary(name="addon", crate="invalid", node_api_version=8)',
        "node_api_version is only supported by rust_node_addon",
      ],
      [
        'rust_node_addon(name="addon", crate="invalid", module="demo._native")',
        "module is only supported by rust_python_extension",
      ],
      [
        'rust_node_addon(name="addon", crate="invalid", build_py_deps=["setuptools"])',
        "build_py_deps is only supported by rust_python_extension",
      ],
      [
        'rust_python_extension(name="addon", module="demo._native", crate="invalid", addon_name="native")',
        "addon_name is only supported by rust_node_addon",
      ],
      [
        'rust_python_extension(name="addon", module="demo._native", crate="invalid", platform="selected")',
        "platform is only supported by rust_node_addon",
      ],
      [
        'rust_binary(name="addon", crate="invalid", python_lockfile_label="//projects/apps/invalid-addon:uv.lock")',
        "unknown arguments: python_lockfile_label",
      ],
      [
        'rust_python_extension(name="addon", module="demo._native", crate="invalid", python_lockfile_label="//projects/apps/invalid-addon:uv.lock")',
        "unknown arguments: python_lockfile_label",
      ],
    ]) {
      await fs.writeFile(
        path.join(invalidDir, "TARGETS"),
        `load("@viberoots//build-tools/rust:defs.bzl", "rust_binary", "rust_node_addon", "rust_python_extension")\n${declaration}\n`,
      );
      const rejected = await $({
        cwd: tmp,
        stdio: "pipe",
        nothrow: true,
      })`buck2 cquery --target-platforms //:no_cgo //projects/apps/invalid-addon:addon`;
      assert.notEqual(rejected.exitCode, 0);
      assert.match(
        `${String(rejected.stdout || "")}\n${String(rejected.stderr || "")}`,
        new RegExp(expected),
      );
    }
  });
});
