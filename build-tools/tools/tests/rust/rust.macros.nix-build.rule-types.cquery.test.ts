#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

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
      path.join(appDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary", "rust_library")',
        "",
        'rust_library(name = "lib", srcs = ["src/lib.rs"])',
        'rust_binary(name = "app", srcs = ["src/main.rs"], deps = [":lib"])',
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
  });
});
