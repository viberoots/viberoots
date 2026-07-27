#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { assertStableInteropGenerator } from "./rust.interop-bindings-fixture";

const sourceRoot = path.resolve(path.basename(process.cwd()) === "viberoots" ? "." : "viberoots");
const generator = path.resolve(
  sourceRoot,
  "build-tools/tools/nix/templates/rust-interop-generate.mjs",
);
const selectedTargetTriple =
  process.platform === "darwin"
    ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`
    : `${process.arch === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-gnu`;

test("reviewed Rust interop generator is byte-stable for C and C++ bindings", async () => {
  await assertStableInteropGenerator($, generator);
});

test("Rust interop macros reject direct ABI ambiguity at analysis time", async () => {
  await runInTemp("rust-interop-analysis", async (tmp, $) => {
    const root = path.join(tmp, "projects/libs/interop");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "Cargo.toml"),
      '[package]\nname="interop"\nversion="0.1.0"\nedition="2021"\n',
    );
    await fs.writeFile(
      path.join(root, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname="interop"\nversion="0.1.0"\n',
    );
    await fs.writeFile(
      path.join(root, "src/lib.rs"),
      '#[no_mangle]\npub extern "C" fn value() -> i32 { 1 }\n',
    );
    await fs.writeFile(
      path.join(root, "bindings.json"),
      '{"schema":"viberoots.rust-interop.v1","functions":[{"name":"value","return":"i32","params":[]}]}\n',
    );
    await fs.writeFile(
      path.join(root, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_cxx_bridge_library")',
        'rust_cxx_bridge_library(name="bad", binding_config="bindings.json", artifact="shared", crate_type="staticlib", srcs=["src/lib.rs"])',
        "",
      ].join("\n"),
    );
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 targets //projects/libs/interop:bad`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /crate_type must be cdylib for artifact=shared/);
    await fs.writeFile(
      path.join(root, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_cxx_bridge_library")',
        'rust_cxx_bridge_library(name="bad", binding_config="bindings.json", cxx_standard="c++20", srcs=["src/lib.rs"])',
        "",
      ].join("\n"),
    );
    const mismatch = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 targets //projects/libs/interop:bad`.nothrow();
    assert.notEqual(mismatch.exitCode, 0);
    assert.match(String(mismatch.stderr), /must match the pinned C\+\+ bridge standard c\+\+17/);
    await fs.writeFile(
      path.join(root, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_library")',
        'rust_library(name="bad", binding_config="bindings.json", interop_kind="cxx", srcs=["src/lib.rs"])',
      ].join("\n"),
    );
    const implicit = await $({ cwd: tmp, stdio: "pipe" })`
      buck2 targets //projects/libs/interop:bad
    `.nothrow();
    assert.notEqual(implicit.exitCode, 0);
    assert.match(String(implicit.stderr), /interop arguments require rust_c_ffi_library/);
    await fs.writeFile(
      path.join(root, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_cxx_bridge_library")',
        'rust_cxx_bridge_library(name="bad", binding_config="bindings.json", compiler_identity="selected-llvm", srcs=["src/lib.rs"])',
      ].join("\n"),
    );
    const compilerSpoof = await $({ cwd: tmp, stdio: "pipe" })`
      buck2 targets //projects/libs/interop:bad
    `.nothrow();
    assert.notEqual(compilerSpoof.exitCode, 0);
    assert.match(String(compilerSpoof.stderr), /compiler_identity is internal/);
    await fs.writeFile(
      path.join(root, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_cxx_bridge_library")',
        'rust_cxx_bridge_library(name="bad", binding_config="bindings.json", target_triple="x86_64-unknown-invalid", srcs=["src/lib.rs"])',
      ].join("\n"),
    );
    const targetMismatch = await $({ cwd: tmp, stdio: "pipe" })`
      buck2 targets //projects/libs/interop:bad
    `.nothrow();
    assert.notEqual(targetMismatch.exitCode, 0);
    assert.match(
      String(targetMismatch.stderr),
      /target_triple must match the selected native target/,
    );
    await fs.writeFile(
      path.join(root, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_cxx_bridge_library")',
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")',
        'nix_cpp_library(name="native", srcs=[])',
        'rust_cxx_bridge_library(name="bridge", binding_config="bindings.json", panic_strategy="abort", exception_policy="noexcept", allocator="caller", thread_safety="send-sync", srcs=["src/lib.rs"], link_deps=[":native"])',
        "",
      ].join("\n"),
    );
    const query = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute binding_config --output-attribute interop_kind --output-attribute interop_generator --output-attribute panic_strategy --output-attribute exception_policy --output-attribute allocator --output-attribute thread_safety --output-attribute cxx_standard --output-attribute compiler_family --output-attribute compiler_identity --output-attribute target_triple --output-attribute stl --output-attribute module_surface --output-attribute generated_outputs --output-attribute link_mode --output-attribute labels "set(//projects/libs/interop:bridge //projects/libs/interop:native)"`;
    const contract = String(query.stdout);
    for (const expected of [
      "bindings.json",
      "viberoots-rust-bindings-1",
      "abort",
      "send-sync",
      "c++17",
      "selected-llvm",
      selectedTargetTriple,
      "libc++",
      "rust-abi:v1:cxx:static:native",
      "bridge.hpp",
      "rust-interop:cxx",
      "abi:cxx-v1",
    ]) {
      assert.match(contract, new RegExp(expected.replaceAll("+", "\\+")));
    }
    assert.equal(contract.match(new RegExp(selectedTargetTriple, "g"))?.length, 2);
  });
});

test("Rust interop planner accepts matched non-default profiles and rejects mismatch", async () => {
  const validator = JSON.stringify(
    path.resolve(sourceRoot, "build-tools/tools/nix/planner/rust-interop-profile.nix"),
  );
  const matched = `
    let
      validate = import ${validator} {
        ctx = {
          get = node: field: node.\${field} or null;
          sourcePlanFor = _node: {
            base_pkgs = {
              stdenv.targetPlatform.rust.rustcTargetSpec = "aarch64-apple-darwin";
              llvmPackages.clang = "/nix/store/profile-pinned-clang";
            };
          };
        };
      };
    in validate {
      nixpkgs_profile = "hardened"; interop_kind = "cxx";
      compiler_identity = "selected-llvm"; target_triple = "aarch64-apple-darwin";
      cxx_standard = "c++17"; stl = "libc++";
    } {
      nixpkgs_profile = "hardened"; module_surface = "native:v1:lib:static";
      compiler_identity = "selected-llvm"; target_triple = "aarch64-apple-darwin";
      language_standard = "c++17"; stl = "libc++";
    } "link" "//projects/libs/native:lib"
  `;
  const accepted = await $({ stdio: "pipe" })`nix eval --impure --json --expr ${matched}`;
  assert.equal(JSON.parse(String(accepted.stdout)), "//projects/libs/native:lib");
  const mismatch = `
    let
      validate = import ${validator} {
        ctx = {
          get = node: field: node.\${field} or null;
          sourcePlanFor = _node: {
            base_pkgs = {
              stdenv.targetPlatform.rust.rustcTargetSpec = "aarch64-apple-darwin";
              llvmPackages.clang = "/nix/store/profile-pinned-clang";
            };
          };
        };
      };
    in validate {
      nixpkgs_profile = "default"; interop_kind = "cxx";
      compiler_identity = "selected-llvm"; target_triple = "aarch64-apple-darwin";
      cxx_standard = "c++17"; stl = "libc++";
    } {
      nixpkgs_profile = "hardened"; module_surface = "native:v1:lib:static";
      compiler_identity = "selected-llvm"; target_triple = "aarch64-apple-darwin";
      language_standard = "c++17"; stl = "libc++";
    } "link" "//projects/libs/native:lib"
  `;
  const result = await $({ stdio: "pipe" })`nix eval --impure --expr ${mismatch}`.nothrow();
  assert.notEqual(result.exitCode, 0);
  assert.match(String(result.stderr), /mismatched nixpkgs_profile/);
});

test("fixed Rust artifact macros reject incompatible crate type and role", async () => {
  await runInTemp("rust-fixed-artifact-contract", async (tmp, $) => {
    const root = path.join(tmp, "projects", "libs", "invalid_rust_artifact");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "Cargo.toml"),
      '[package]\nname="invalid_rust_artifact"\nversion="0.1.0"\nedition="2021"\n',
    );
    await fs.writeFile(
      path.join(root, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname="invalid_rust_artifact"\nversion="0.1.0"\n',
    );
    await fs.writeFile(path.join(root, "src", "lib.rs"), "pub fn value() -> i32 { 1 }\n");
    for (const [name, macroArgs, expected] of [
      ["bad_type", 'crate_type = "cdylib"', /rust_static_library: crate_type must be staticlib/],
      ["bad_role", 'host_role = "host"', /rust_static_library: host_role must be target/],
      ["bad_slash", 'public_crate = "bad/name"', /public_crate must match/],
      ["bad_digit", 'public_crate = "9bad"', /public_crate must match/],
      ["bad_hyphen", 'public_crate = "bad-name"', /public_crate must match/],
      ["bad_meta", 'public_crate = "bad$HOME"', /public_crate must match/],
    ] as const) {
      await fs.writeFile(
        path.join(root, "TARGETS"),
        [
          'load("@viberoots//build-tools/rust:defs.bzl", "rust_static_library")',
          `rust_static_library(name = "${name}", ${macroArgs}, srcs = ["src/lib.rs"])`,
          "",
        ].join("\n"),
      );
      const result = await $({
        cwd: tmp,
        stdio: "pipe",
      })`buck2 targets ${`//projects/libs/invalid_rust_artifact:${name}`}`.nothrow();
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), expected);
    }
  });
});
