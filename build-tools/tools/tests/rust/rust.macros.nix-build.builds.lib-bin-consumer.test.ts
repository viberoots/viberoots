#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("rust macros: library, binary, and downstream consumer build via Nix-backed route", async () => {
  await runInTemp("rust-nix-builds-lib-bin-consumer", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "rustapp");
    await fs.mkdirp(path.join(appDir, "src"));
    await fs.writeFile(
      path.join(appDir, "src", "lib.rs"),
      "pub fn sum(a:i32,b:i32)->i32{a+b}\n",
      "utf8",
    );
    await fs.writeFile(path.join(appDir, "src", "main.rs"), "fn main(){}\n", "utf8");
    await fs.writeFile(path.join(appDir, "src", "consumer.rs"), "fn main(){}\n", "utf8");
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/rust:defs.bzl", "rust_binary", "rust_library")',
        "",
        'rust_library(name = "lib", srcs = ["src/lib.rs"])',
        'rust_binary(name = "app", srcs = ["src/main.rs"], deps = [":lib"])',
        'rust_binary(name = "consumer", srcs = ["src/consumer.rs"], deps = [":lib"])',
        "",
      ].join("\n"),
      "utf8",
    );

    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --show-output //projects/apps/rustapp:consumer`;
    assert.equal(build.exitCode, 0, `buck2 build failed:\n${String(build.stderr || build.stdout)}`);
  });
});
