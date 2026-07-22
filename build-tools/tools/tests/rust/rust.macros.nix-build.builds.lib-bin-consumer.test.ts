#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers";

test("rust macros: library, binary, and downstream consumer build via Nix-backed route", async () => {
  await runInTemp("rust-nix-builds-lib-bin-consumer", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "rustapp");
    await fs.mkdirp(path.join(appDir, "src"));
    await fs.writeFile(
      path.join(appDir, "src", "lib.rs"),
      'pub fn message()->&\'static str{"first"}\n',
      "utf8",
    );
    await fs.writeFile(
      path.join(appDir, "src", "main.rs"),
      'fn main(){println!("{}",rustapp::message());}\n',
      "utf8",
    );
    await fs.writeFile(
      path.join(appDir, "src", "consumer.rs"),
      'fn main(){println!("consumer:{}",rustapp::message());}\n',
      "utf8",
    );
    await fs.writeFile(
      path.join(appDir, "Cargo.toml"),
      [
        "[package]",
        'name = "rustapp"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[lib]",
        'path = "src/lib.rs"',
        "",
        "[[bin]]",
        'name = "app"',
        'path = "src/main.rs"',
        "",
        "[[bin]]",
        'name = "consumer"',
        'path = "src/consumer.rs"',
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(appDir, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname = "rustapp"\nversion = "0.1.0"\n',
      "utf8",
    );
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary", "rust_library")',
        "",
        'rust_library(name = "lib", crate = "rustapp", srcs = ["src/lib.rs"])',
        'rust_binary(name = "app", crate = "rustapp", srcs = ["src/main.rs"], deps = [":lib"])',
        'rust_binary(name = "consumer", crate = "rustapp", srcs = ["src/consumer.rs"], deps = [":lib"])',
        "",
      ].join("\n"),
      "utf8",
    );
    await reconcileTempDependencyInputs(tmp, $);

    const hostileDir = path.join(tmp, "hostile-bin");
    await fs.mkdirp(hostileDir);
    for (const tool of ["cargo", "rustc", "cc"]) {
      await fs.writeFile(path.join(hostileDir, tool), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
    }
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        PATH: `${hostileDir}:${process.env.PATH}`,
        RUSTC: path.join(hostileDir, "rustc"),
        RUSTFLAGS: "--definitely-invalid-host-flag",
        RUSTUP_HOME: path.join(tmp, "hostile-rustup"),
      },
    })`buck2 build --show-output //projects/apps/rustapp:app //projects/apps/rustapp:consumer`;
    assert.equal(build.exitCode, 0, `buck2 build failed:\n${String(build.stderr || build.stdout)}`);
    const outputs = new Map(
      String(build.stdout || "")
        .trim()
        .split("\n")
        .map((line) => line.trim().split(/\s+/, 2) as [string, string]),
    );
    const run = async (label: string) => {
      const output = outputs.get(label) || outputs.get(label.replace("root//", "//"));
      assert.ok(output, `missing --show-output path for ${label}`);
      const result = await $({ cwd: tmp, stdio: "pipe" })`${path.resolve(tmp, output)}`;
      return String(result.stdout || "").trim();
    };
    assert.equal(await run("root//projects/apps/rustapp:app"), "first");
    assert.equal(await run("root//projects/apps/rustapp:consumer"), "consumer:first");

    await fs.writeFile(
      path.join(appDir, "src", "lib.rs"),
      'pub fn message()->&\'static str{"second"}\n',
    );
    const rebuilt = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --show-output //projects/apps/rustapp:consumer`;
    const rebuiltPath = String(rebuilt.stdout || "")
      .trim()
      .split(/\s+/)
      .at(-1);
    assert.ok(rebuiltPath, "missing rebuilt consumer output");
    const rerun = await $({ cwd: tmp, stdio: "pipe" })`${path.resolve(tmp, rebuiltPath)}`;
    assert.equal(String(rerun.stdout || "").trim(), "consumer:second");
  });
});
