#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function firstCqueryNode<T>(json: unknown): T | null {
  if (Array.isArray(json)) return (json[0] as T) ?? null;
  if (json && typeof json === "object") {
    const values = Object.values(json as Record<string, unknown>);
    const first = values[0];
    if (Array.isArray(first)) return (first[0] as T) ?? null;
    return (first as T) ?? null;
  }
  return null;
}

test("rust macros: rust_library and rust_binary use rust_nix_build", async () => {
  await runInTemp("rust-nix-build-rule-types", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "rustapp");
    await fs.mkdirp(path.join(appDir, "src"));
    await fs.writeFile(
      path.join(appDir, "src", "lib.rs"),
      "pub fn add(a:i32,b:i32)->i32{a+b}\n",
      "utf8",
    );
    await fs.writeFile(path.join(appDir, "src", "main.rs"), "fn main(){}\n", "utf8");
    await fs.writeFile(
      path.join(appDir, "Cargo.toml"),
      '[package]\nname="rustapp"\nversion="0.1.0"\nedition="2021"\n',
    );
    await fs.writeFile(
      path.join(appDir, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname = "rustapp"\nversion = "0.1.0"\n',
    );
    await fs.mkdirp(path.join(appDir, "patches", "rust"));
    await fs.writeFile(
      path.join(appDir, "patches", "rust", "demo.patch"),
      "diff --git a/src/lib.rs b/src/lib.rs\n",
    );
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary", "rust_library")',
        "",
        'rust_library(name = "lib", crate = "rustapp", features = ["demo"], default_features = False, srcs = ["src/lib.rs"])',
        'rust_binary(name = "app", crate = "rustapp", srcs = ["src/main.rs"], deps = [":lib"])',
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
    assert.ok(String(libProbe.stdout || "").includes("//projects/apps/rustapp:lib"));

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

    const fields = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cargo_manifest --output-attribute cargo_lock --output-attribute crate --output-attribute features --output-attribute default_features --output-attribute profile --output-attribute target --output-attribute local_patch_dirs --output-attribute deps --output-attribute srcs --output-attribute labels //projects/apps/rustapp:lib`;
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
      srcs?: string[];
    }>(JSON.parse(serialized));
    assert.equal(node?.default_features, false);
    assert.deepEqual(node?.local_patch_dirs, ["patches/rust"]);
    assert.ok(node?.labels?.includes("patch_scope:package-local"));
    assert.ok(
      node?.srcs?.some((source) => String(source).endsWith("patches/rust/demo.patch")),
      `real Rust patch file is not a declared action input: ${JSON.stringify(node?.srcs)}`,
    );
  });
});
