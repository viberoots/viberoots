#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

const sourceRoot = path.resolve(path.basename(process.cwd()) === "viberoots" ? "." : "viberoots");
const validator = path.join(sourceRoot, "build-tools/tools/nix/planner/rust-interop-profile.nix");
const baseRust = {
  interop_kind: "cxx",
  nixpkgs_profile: "hardened",
  nixpkg_pins: { openssl: { version: "3" } },
  compiler_family: "llvm",
  compiler_identity: "selected-llvm",
  target_triple: "aarch64-apple-darwin",
  cxx_standard: "c++17",
  stl: "libc++",
};
const baseNative = {
  module_surface: "native:v1:lib:static",
  nixpkgs_profile: "hardened",
  nixpkg_pins: { openssl: { version: "3" } },
  compiler_family: "llvm",
  compiler_identity: "selected-llvm",
  target_triple: "aarch64-apple-darwin",
  language_standard: "c++17",
  stl: "libc++",
};

async function evaluate(left: object, right: object) {
  const expression = `
    let validate = import ${JSON.stringify(validator)} {
      ctx = {
        get = node: field: node.\${field} or null;
        sourcePlanFor = node: {
          base_pkgs = {
            stdenv.targetPlatform.rust.rustcTargetSpec = "aarch64-apple-darwin";
            llvmPackages.clang = node.selected_compiler or "/nix/store/profile-pinned-clang";
          };
        };
      };
    }; in validate (builtins.fromJSON ${JSON.stringify(JSON.stringify(left))})
      (builtins.fromJSON ${JSON.stringify(JSON.stringify(right))})
      "link" "//projects/libs/native:lib"
  `;
  return await $({ stdio: "pipe" })`nix eval --impure --json --expr ${expression}`.nothrow();
}

test("Rust native interop accepts one exact profile, pin, compiler, target, std, and STL identity", async () => {
  const accepted = await evaluate(baseRust, baseNative);
  assert.equal(accepted.exitCode, 0, String(accepted.stderr));
  assert.equal(JSON.parse(String(accepted.stdout)), "//projects/libs/native:lib");
});

test("Rust native interop rejects every compatibility-axis mismatch", async () => {
  const mismatches: Array<[string, object]> = [
    ["nixpkgs_profile", { nixpkgs_profile: "default" }],
    ["nixpkg_pins", { nixpkg_pins: { openssl: { version: "1" } } }],
    ["compiler_family", { compiler_family: "gcc" }],
    ["compiler_identity", { compiler_identity: "llvm-other" }],
    ["target_triple", { target_triple: "x86_64-linux" }],
    ["cxx_standard", { language_standard: "c++20" }],
    ["stl", { stl: "libstdc++" }],
    ["module_surface", { module_surface: "wasm:v1:lib:static" }],
    ["compiler_identity", { selected_compiler: "/nix/store/other-profile-clang" }],
  ];
  for (const [field, changed] of mismatches) {
    const result = await evaluate(baseRust, { ...baseNative, ...changed });
    assert.notEqual(result.exitCode, 0, field);
    assert.match(String(result.stderr), new RegExp(field), field);
  }
});

test("Rust and C++ template construction uses the non-default profile LLVM package", async () => {
  const template = JSON.stringify(
    path.resolve(sourceRoot, "build-tools/tools/nix/templates/rust-interop.nix"),
  );
  const cppTemplate = JSON.stringify(
    path.resolve(sourceRoot, "build-tools/tools/nix/templates/cpp-app.nix"),
  );
  const expression = `
    let
      base = import <nixpkgs> {};
      profilePkgs = base // {
        llvmPackages = base.llvmPackages // {
          clang = base.symlinkJoin {
              name = "non-default-profile-clang";
              paths = [ base.llvmPackages.clang ];
          };
        };
      };
      construct = compilerIdentity:
        import ${template} {
          pkgs = profilePkgs;
          lib = profilePkgs.lib;
          publicCrate = "profile_bridge";
          nativePackages = [];
          interop = {
            interopKind = "c";
            interopGenerator = "viberoots-rust-bindings-1";
            bindingConfig = builtins.toFile "bindings.json"
              "{\\"schema\\":\\"viberoots.rust-interop.v1\\",\\"functions\\":[]}";
            compilerFamily = "llvm";
            inherit compilerIdentity;
            cStandard = "c11";
            stl = "none";
            targetTriple = profilePkgs.stdenv.targetPlatform.rust.rustcTargetSpec;
          };
        };
      matched = construct (builtins.toString profilePkgs.llvmPackages.clang);
      mismatched = construct (builtins.toString base.llvmPackages.clang);
      cppConstruct = compilerIdentity:
        (import ${cppTemplate} { pkgs = profilePkgs; }).cppApp {
          name = "profile-cpp";
          srcRoot = ${JSON.stringify(sourceRoot)};
          subdir = "build-tools/tools/tests/rust";
          srcList = [];
          inherit compilerIdentity;
          targetTriple = profilePkgs.stdenv.targetPlatform.rust.rustcTargetSpec;
        };
      cppMatched = cppConstruct (builtins.toString profilePkgs.llvmPackages.clang);
      cppMismatched = cppConstruct (builtins.toString base.llvmPackages.clang);
    in {
      compilerIdentity = matched.passthru.compilerIdentity;
      generated = matched.passthru.generated_package.drvPath;
      mismatch = builtins.tryEval mismatched.passthru.generated_package.drvPath;
      cpp = cppMatched.drvPath;
      cppMismatch = builtins.tryEval cppMismatched.drvPath;
    }
  `;
  const result = await $({ stdio: "pipe" })`nix eval --impure --json --expr ${expression}`;
  const value = JSON.parse(String(result.stdout));
  assert.match(value.compilerIdentity, /non-default-profile-clang/);
  assert.match(value.generated, /\.drv$/);
  assert.equal(value.mismatch.success, false);
  assert.match(value.cpp, /\.drv$/);
  assert.equal(value.cppMismatch.success, false);
});
