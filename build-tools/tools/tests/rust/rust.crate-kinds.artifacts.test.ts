#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exportGraphInTemp, runInTemp } from "../lib/test-helpers";

function outputPath(stdout: string, target: string): string {
  const line = stdout
    .split("\n")
    .find((candidate) => candidate.trim().split(/\s+/, 1)[0].endsWith(target));
  const relative = line?.trim().split(/\s+/).at(-1);
  assert.ok(relative, `missing Buck output for ${target}: ${stdout}`);
  return relative;
}

test("Rust native crate kinds expose stable artifacts and staticlib links into C++", async () => {
  await runInTemp("rust-native-crate-kinds", async (tmp, $) => {
    const root = path.join(tmp, "projects", "libs", "rust_abi");
    const runtime = path.join(tmp, "projects", "libs", "rust_runtime");
    const consumer = path.join(tmp, "projects", "apps", "rust_abi_consumer");
    await fsp.mkdir(path.join(root, "src"), { recursive: true });
    await fsp.mkdir(path.join(runtime, "src"), { recursive: true });
    await fsp.mkdir(path.join(consumer, "src"), { recursive: true });
    await fsp.writeFile(
      path.join(runtime, "src", "runtime.cpp"),
      'extern "C" int native_runtime_value() { return 40; }\n',
    );
    await fsp.writeFile(
      path.join(runtime, "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")',
        'nix_cpp_library(name = "runtime", link_mode = "shared", srcs = ["src/runtime.cpp"], visibility = ["PUBLIC"])',
        "",
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(root, "Cargo.toml"),
      [
        "[package]",
        'name = "rust_abi"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[lib]",
        'crate-type = ["rlib", "staticlib", "cdylib"]',
        "",
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(root, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname = "rust_abi"\nversion = "0.1.0"\n',
    );
    await fsp.writeFile(
      path.join(root, "src", "lib.rs"),
      [
        '#[link(name = "projects-libs-rust_runtime-runtime")]',
        'extern "C" { fn native_runtime_value() -> i32; }',
        "#[no_mangle]",
        'pub extern "C" fn rust_answer() -> i32 { unsafe { native_runtime_value() + 2 } }',
        "",
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(root, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_cdylib", "rust_library", "rust_static_library")',
        'rust_library(name = "rlib", crate = "rust_abi", public_crate = "public_abi", srcs = ["src/lib.rs"], link_deps = ["//projects/libs/rust_runtime:runtime"])',
        'rust_static_library(name = "static", crate = "rust_abi", public_crate = "rust_abi", srcs = ["src/lib.rs"], link_deps = ["//projects/libs/rust_runtime:runtime"], visibility = ["PUBLIC"])',
        'rust_cdylib(name = "dynamic", crate = "rust_abi", public_crate = "rust_abi", srcs = ["src/lib.rs"], link_deps = ["//projects/libs/rust_runtime:runtime"])',
        "",
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(consumer, "src", "main.cpp"),
      '#include <cstdio>\nextern "C" int rust_answer();\nint main() { std::printf("%d\\n", rust_answer()); return 0; }\n',
    );
    await fsp.writeFile(
      path.join(consumer, "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_binary")',
        'nix_cpp_binary(name = "app", srcs = ["src/main.cpp"], link_deps = ["//projects/libs/rust_abi:static"])',
        "",
      ].join("\n"),
    );
    const targets = [
      "//projects/libs/rust_abi:rlib",
      "//projects/libs/rust_abi:static",
      "//projects/libs/rust_abi:dynamic",
      "//projects/apps/rust_abi_consumer:app",
    ];
    assert.match(
      await fsp.readFile(path.join(tmp, ".viberoots/workspace/flake.nix"), "utf8"),
      /viberoots\.url\s*=/,
      "temp consumer generated workspace must declare the viberoots input",
    );
    await exportGraphInTemp({ tmp, $ });
    const build = await $({ cwd: tmp, stdio: "pipe" })`
      buck2 build --show-output ${targets}
    `;
    const stdout = String(build.stdout);
    const rlibPath = path.join(tmp, outputPath(stdout, targets[0]));
    const staticPath = path.join(tmp, outputPath(stdout, targets[1]));
    const dynamicPath = path.join(tmp, outputPath(stdout, targets[2]));
    const appPath = path.join(tmp, outputPath(stdout, targets[3]));
    assert.equal(path.basename(rlibPath), "libpublic_abi.rlib");
    assert.equal(path.basename(staticPath), "librust_abi.a");
    assert.equal(path.basename(dynamicPath), "librust_abi.cdylib");
    assert.equal((await fsp.readFile(rlibPath)).subarray(0, 8).toString(), "!<arch>\n");
    const archive = await fsp.readFile(staticPath);
    assert.equal(archive.subarray(0, 8).toString(), "!<arch>\n");
    assert.ok((await fsp.stat(dynamicPath)).size > 0);
    const python = String(process.env.VBR_ARTIFACT_TOOLS_ROOT || "") + "/bin/python3";
    const load = await $({ cwd: tmp, stdio: "pipe" })`
      ${python} -c ${`import ctypes; lib=ctypes.CDLL(${JSON.stringify(dynamicPath)}); assert lib.rust_answer() == 42`}
    `;
    assert.equal(load.exitCode, 0);
    const linked = await $({ cwd: tmp, stdio: "pipe" })`${appPath}`;
    assert.equal(String(linked.stdout).trim(), "42");
  });
});

test("fixed Rust artifact macros reject incompatible crate type and role", async () => {
  await runInTemp("rust-fixed-artifact-contract", async (tmp, $) => {
    const root = path.join(tmp, "projects", "libs", "invalid_rust_artifact");
    await fsp.mkdir(path.join(root, "src"), { recursive: true });
    await fsp.writeFile(
      path.join(root, "Cargo.toml"),
      '[package]\nname="invalid_rust_artifact"\nversion="0.1.0"\nedition="2021"\n',
    );
    await fsp.writeFile(
      path.join(root, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname="invalid_rust_artifact"\nversion="0.1.0"\n',
    );
    await fsp.writeFile(path.join(root, "src", "lib.rs"), "pub fn value() -> i32 { 1 }\n");
    for (const [name, macroArgs, expected] of [
      ["bad_type", 'crate_type = "cdylib"', /rust_static_library: crate_type must be staticlib/],
      ["bad_role", 'host_role = "host"', /rust_static_library: host_role must be target/],
      ["bad_slash", 'public_crate = "bad/name"', /public_crate must match/],
      ["bad_digit", 'public_crate = "9bad"', /public_crate must match/],
      ["bad_hyphen", 'public_crate = "bad-name"', /public_crate must match/],
      ["bad_meta", 'public_crate = "bad$HOME"', /public_crate must match/],
    ] as const) {
      await fsp.writeFile(
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
