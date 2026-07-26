#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { commandEnv } from "../viberoots/remote-consumer-boundary";

test("Rust freestanding and WASI macros produce executable WebAssembly", async () => {
  await runInTemp("rust-wasm-wasi", async (tmp, $) => {
    const root = path.join(tmp, "projects/apps/rust-wasm");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "Cargo.toml"),
      [
        "[package]",
        'name = "rust_wasm_fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[lib]",
        'crate-type = ["cdylib"]',
        "",
        "[[bin]]",
        'name = "wasi_demo"',
        'path = "src/main.rs"',
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(root, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname = "rust_wasm_fixture"\nversion = "0.1.0"\n',
    );
    await fs.writeFile(
      path.join(root, "src/lib.rs"),
      '#[no_mangle]\npub extern "C" fn answer() -> i32 { 42 }\n',
    );
    await fs.writeFile(path.join(root, "src/main.rs"), 'fn main() { println!("wasi-rust-ok"); }\n');
    await fs.writeFile(
      path.join(root, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_wasi_binary", "rust_wasm_library")',
        'rust_wasm_library(name = "raw", crate = "rust_wasm_fixture", srcs = ["src/lib.rs"])',
        'rust_wasi_binary(name = "wasi_demo", crate = "rust_wasm_fixture", srcs = ["src/main.rs"])',
        "",
      ].join("\n"),
    );
    await reconcileTempDependencyInputs(tmp, $);
    const built = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --show-output //projects/apps/rust-wasm:raw //projects/apps/rust-wasm:wasi_demo`;
    const outputs = String(built.stdout)
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 2);
    const outputFor = (target: string) => {
      const row = outputs.find(([label]) => label === target || label.endsWith(target));
      assert.ok(row, `missing Buck output for ${target}: ${String(built.stdout)}`);
      return path.resolve(tmp, row[1]);
    };
    const raw = outputFor("//projects/apps/rust-wasm:raw");
    const wasi = outputFor("//projects/apps/rust-wasm:wasi_demo");
    const rawBytes = await fs.readFile(raw);
    const rawModule = await WebAssembly.instantiate(rawBytes);
    assert.equal((rawModule.instance.exports.answer as () => number)(), 42);

    const runner = viberootsSourcePath("viberoots/build-tools/tools/wasm/wasi-runner.mjs");
    const executed = await $({ cwd: tmp, stdio: "pipe" })`node ${runner} ${wasi}`;
    assert.match(String(executed.stdout), /wasi-rust-ok/);

    const viaDeclaredContract = await $({
      cwd: tmp,
      env: commandEnv(tmp),
      stdio: "pipe",
    })`p //projects/apps/rust-wasm:wasi_demo`;
    assert.match(String(viaDeclaredContract.stdout), /wasi-rust-ok/);
  });
});
