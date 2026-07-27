#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exportGraphInTemp, runInTemp } from "../lib/test-helpers";

test("generated Rust ABI verification rejects schema/source signature drift", async () => {
  await runInTemp("rust-interop-rust-abi-mismatch", async (tmp, $) => {
    const root = path.join(tmp, "projects/libs/abi_mismatch");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "Cargo.toml"),
      '[package]\nname="abi_mismatch"\nversion="0.1.0"\nedition="2021"\n[lib]\ncrate-type=["staticlib"]\n',
    );
    await fs.writeFile(
      path.join(root, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname = "abi_mismatch"\nversion = "0.1.0"\n',
    );
    await fs.writeFile(
      path.join(root, "src/lib.rs"),
      '#[no_mangle]\npub extern "C" fn abi_value(value: i32) -> i32 { value }\n',
    );
    await fs.writeFile(
      path.join(root, "bindings.json"),
      '{"schema":"viberoots.rust-interop.v1","functions":[{"name":"abi_value","return":"i64","params":[{"name":"value","type":"i32"}]}]}\n',
    );
    await fs.writeFile(
      path.join(root, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_c_ffi_library")',
        'rust_c_ffi_library(name="bridge", crate="abi_mismatch", binding_config="bindings.json", srcs=["src/lib.rs"])',
      ].join("\n"),
    );
    await exportGraphInTemp({ tmp, $ });
    const graph = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    const generator = path.resolve(
      path.basename(process.cwd()) === "viberoots" ? "." : "viberoots",
      "build-tools/tools/nix/graph-generator.nix",
    );
    const system = process.platform === "darwin" ? "aarch64-darwin" : "x86_64-linux";
    const result = await $({
      cwd: tmp,
      env: { ...process.env, BUCK_TARGET: "//projects/libs/abi_mismatch:bridge" },
      stdio: "pipe",
    })`nix build --impure --accept-flake-config --file ${generator} selected --arg pkgs ${"import <nixpkgs> {}"} --arg src ./. --argstr system ${system} --argstr graphJsonPath ${graph} --no-link`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /expected fn pointer.*i64|mismatched types/s);
  });
});
