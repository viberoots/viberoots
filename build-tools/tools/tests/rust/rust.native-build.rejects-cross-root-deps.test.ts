#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { killBuckDaemonsForRepo } from "../lib/test-helpers/buck-kill";
import { reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers";

function buckEventBusTransient(output: unknown): boolean {
  return /Buck daemon event bus|broken pipe|h2 protocol error/i.test(String(output || ""));
}

async function writeCargoRoot(
  root: string,
  name: string,
  targets: string,
  manifestExtra = "",
  librarySource = "pub fn value() -> u8 { 1 }\n",
): Promise<void> {
  await fsp.mkdir(path.join(root, "src"), { recursive: true });
  await fsp.writeFile(path.join(root, "src/lib.rs"), librarySource);
  await fsp.writeFile(path.join(root, "src/main.rs"), "fn main() {}\n");
  await fsp.writeFile(
    path.join(root, "Cargo.toml"),
    `[package]\nname="${name}"\nversion="0.1.0"\nedition="2021"\n${manifestExtra}`,
  );
  await fsp.writeFile(
    path.join(root, "Cargo.lock"),
    `version = 3\n\n[[package]]\nname="${name}"\nversion="0.1.0"\n`,
  );
  await fsp.writeFile(path.join(root, "TARGETS"), targets);
}

test("rust builds reviewed Cargo path dependencies across Buck roots", async () => {
  await runInTemp("rust-cross-root-composition", async (tmp, $) => {
    const load = 'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary", "rust_library")';
    await writeCargoRoot(
      path.join(tmp, "projects/libs/core"),
      "core",
      `${load}\nrust_library(name="core", crate="core", srcs=["src/lib.rs"], visibility=["PUBLIC"])\n`,
    );
    await writeCargoRoot(
      path.join(tmp, "projects/libs/mid"),
      "mid",
      `${load}\nrust_library(name="mid", crate="mid", srcs=["src/lib.rs"], deps=["//projects/libs/core:core"], visibility=["PUBLIC"])\n`,
      '\n[dependencies]\ncore = { path = "../core", version = "0.1.0" }\n',
      "pub fn value() -> u8 { core::value() + 1 }\n",
    );
    await fsp.writeFile(
      path.join(tmp, "projects/libs/mid/Cargo.lock"),
      [
        "version = 3",
        "",
        "[[package]]",
        'name = "core"',
        'version = "0.1.0"',
        "",
        "[[package]]",
        'name = "mid"',
        'version = "0.1.0"',
        'dependencies = ["core"]',
        "",
      ].join("\n"),
    );
    await writeCargoRoot(
      path.join(tmp, "projects/libs/derive_demo"),
      "derive_demo",
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_proc_macro")\nrust_proc_macro(name="derive_demo", crate="derive_demo", srcs=["src/lib.rs"], visibility=["PUBLIC"])\n',
      "\n[lib]\nproc-macro = true\n",
      [
        "extern crate proc_macro;",
        "use proc_macro::TokenStream;",
        '#[proc_macro] pub fn answer(_: TokenStream) -> TokenStream { "40 + 2".parse().unwrap() }',
        "",
      ].join("\n"),
    );
    await writeCargoRoot(
      path.join(tmp, "projects/apps/app"),
      "app",
      `${load}\nrust_binary(name="app", crate="app", srcs=["src/main.rs"], deps=["//projects/libs/mid:mid", "//projects/libs/derive_demo:derive_demo"])\n`,
      [
        "",
        "[dependencies]",
        'mid = { path = "../../libs/mid", version = "0.1.0" }',
        'derive_demo = { path = "../../libs/derive_demo", version = "0.1.0" }',
        "",
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(tmp, "projects/apps/app/src/main.rs"),
      'use derive_demo::answer;\nfn main() { println!("cross-root={}:{}", mid::value(), answer!()); }\n',
    );
    await fsp.writeFile(
      path.join(tmp, "projects/apps/app/Cargo.lock"),
      [
        "version = 3",
        "",
        "[[package]]",
        'name = "app"',
        'version = "0.1.0"',
        'dependencies = ["derive_demo", "mid"]',
        "",
        "[[package]]",
        'name = "core"',
        'version = "0.1.0"',
        "",
        "[[package]]",
        'name = "derive_demo"',
        'version = "0.1.0"',
        "",
        "[[package]]",
        'name = "mid"',
        'version = "0.1.0"',
        'dependencies = ["core"]',
        "",
      ].join("\n"),
    );
    const wasi = path.join(tmp, "projects/apps/wasi_host");
    await writeCargoRoot(
      wasi,
      "wasi_host",
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_wasi_binary")\nrust_wasi_binary(name="wasi_host", crate="wasi_host", srcs=["build.rs", "src/main.rs"], deps=["//projects/libs/derive_demo:derive_demo"])\n',
      '\nbuild = "build.rs"\n[dependencies]\nderive_demo = { path = "../../libs/derive_demo", version = "0.1.0" }\n',
    );
    await fsp.writeFile(
      path.join(wasi, "build.rs"),
      [
        "use std::{env, net::{SocketAddr, TcpStream}, process::Command, time::Duration};",
        "fn main() {",
        '  assert_eq!(env::var("CARGO_NET_OFFLINE").unwrap(), "true");',
        '  assert!(Command::new("ambient-rust-tool").status().is_err());',
        '  let address: SocketAddr = "1.1.1.1:80".parse().unwrap();',
        "  assert!(TcpStream::connect_timeout(&address, Duration::from_millis(50)).is_err());",
        "}",
        "",
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(wasi, "src/main.rs"),
      'use derive_demo::answer;\nfn main() { println!("{}", answer!()); }\n',
    );
    await fsp.writeFile(
      path.join(wasi, "Cargo.lock"),
      [
        "version = 3",
        "[[package]]",
        'name = "derive_demo"',
        'version = "0.1.0"',
        "[[package]]",
        'name = "wasi_host"',
        'version = "0.1.0"',
        'dependencies = ["derive_demo"]',
        "",
      ].join("\n"),
    );
    const hostile = path.join(tmp, "hostile-bin");
    await fsp.mkdir(hostile);
    await fsp.writeFile(path.join(hostile, "ambient-rust-tool"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    await reconcileTempDependencyInputs(tmp, $);
    const buildEnv = {
      ...process.env,
      PATH: `${hostile}${path.delimiter}${String(process.env.PATH || "")}`,
      CARGO_HOME: path.join(tmp, "hostile-cargo-home"),
      RUSTUP_HOME: path.join(tmp, "hostile-rustup-home"),
    };
    const build = async () =>
      await $({
        cwd: tmp,
        env: buildEnv,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 build //projects/apps/app:app //projects/apps/wasi_host:wasi_host`;
    let result = await build();
    if (result.exitCode !== 0 && buckEventBusTransient(`${result.stderr}\n${result.stdout}`)) {
      await killBuckDaemonsForRepo(tmp, $);
      result = await build();
    }
    assert.equal(result.exitCode, 0, String(result.stderr || result.stdout));
    const output = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --show-output //projects/apps/app:app`;
    const executable = String(output.stdout).trim().split(/\s+/).at(-1);
    assert.ok(executable, "Buck did not report the composed Rust binary");
    const run = await $({ cwd: tmp, stdio: "pipe" })`${path.join(tmp, executable)}`;
    assert.match(String(run.stdout), /cross-root=2:42/);
  });
});
