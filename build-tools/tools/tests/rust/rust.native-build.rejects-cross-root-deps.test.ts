#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers";

async function writeCargoRoot(root: string, name: string, targets: string): Promise<void> {
  await fsp.mkdir(path.join(root, "src"), { recursive: true });
  await fsp.writeFile(path.join(root, "src/lib.rs"), "pub fn value() -> u8 { 1 }\n");
  await fsp.writeFile(path.join(root, "src/main.rs"), "fn main() {}\n");
  await fsp.writeFile(
    path.join(root, "Cargo.toml"),
    `[package]\nname="${name}"\nversion="0.1.0"\nedition="2021"\n`,
  );
  await fsp.writeFile(
    path.join(root, "Cargo.lock"),
    `version = 3\n\n[[package]]\nname="${name}"\nversion="0.1.0"\n`,
  );
  await fsp.writeFile(path.join(root, "TARGETS"), targets);
}

test("rust planner rejects cross-root Rust dependency injection", async () => {
  await runInTemp("rust-reject-cross-root", async (tmp, $) => {
    const load = 'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary", "rust_library")';
    await writeCargoRoot(
      path.join(tmp, "projects/libs/core"),
      "core",
      `${load}\nrust_library(name="core", crate="core", srcs=["src/lib.rs"], visibility=["PUBLIC"])\n`,
    );
    await writeCargoRoot(
      path.join(tmp, "projects/apps/app"),
      "app",
      `${load}\nrust_binary(name="app", crate="app", srcs=["src/main.rs"], deps=["//projects/libs/core:core"])\n`,
    );
    await reconcileTempDependencyInputs(tmp, $);
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build //projects/apps/app:app`;
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr || result.stdout), /unsupported cross-root Rust deps/);
  });
});
