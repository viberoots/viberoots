#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("public ordinary Rust macros cannot bypass reviewed generated native bindings", async () => {
  await runInTemp("rust-native-abi-public-boundary", async (tmp, $) => {
    const app = path.join(tmp, "projects/apps/rust-native-bypass");
    await fs.mkdir(path.join(app, "src"), { recursive: true });
    await fs.writeFile(
      path.join(app, "Cargo.toml"),
      '[package]\nname="rust_native_bypass"\nversion="0.1.0"\nedition="2021"\n',
    );
    await fs.writeFile(
      path.join(app, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname="rust_native_bypass"\nversion="0.1.0"\n',
    );
    await fs.writeFile(
      path.join(app, "src/main.rs"),
      'unsafe extern "C" { fn handwritten_native() -> i32; }\nfn main() { println!("{}", unsafe { handwritten_native() }); }\n',
    );
    await fs.writeFile(
      path.join(app, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary")',
        'rust_binary(name = "app", srcs = ["src/main.rs"], link_deps = ["//projects/libs/native:lib"], header_deps = ["//projects/libs/native:headers"])',
        "",
      ].join("\n"),
    );
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms //:no_cgo //projects/apps/rust-native-bypass:app`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(
      String(result.stderr),
      /native link_deps\/header_deps are private bridge wiring; use rust_c_ffi_library or rust_cxx_bridge_library with a reviewed binding_config/,
    );
  });
});

test("internal Rust planner retains targeted diagnostics for invalid native closure artifacts", async () => {
  await runInTemp("rust-c-interop-unsupported", async (tmp, $) => {
    const app = path.join(tmp, "projects/apps/rust-unsupported");
    await fs.mkdir(path.join(app, "src"), { recursive: true });
    await fs.writeFile(
      path.join(app, "Cargo.toml"),
      '[package]\nname="rust_unsupported"\nversion="0.1.0"\nedition="2021"\n',
    );
    await fs.writeFile(
      path.join(app, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname="rust_unsupported"\nversion="0.1.0"\n',
    );
    await fs.writeFile(path.join(app, "src/main.rs"), "fn main() {}\n");
    const graph = [
      {
        name: "//projects/libs/not-c:not-c",
        rule_type: "go_nix_build",
        labels: ["lang:go", "kind:lib"],
      },
      {
        name: "//projects/apps/rust-unsupported:rust-unsupported",
        rule_type: "rust_nix_build",
        labels: ["lang:rust", "kind:bin"],
        cargo_manifest: "Cargo.toml",
        cargo_lock: "Cargo.lock",
        crate: "rust_unsupported",
        srcs: ["src/main.rs"],
        link_deps: ["//projects/libs/not-c:not-c"],
        header_deps: [],
        link_closure: "direct",
        link_closure_overrides: {},
      },
    ];
    const graphPath = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    await fs.mkdir(path.dirname(graphPath), { recursive: true });
    await fs.writeFile(graphPath, JSON.stringify(graph));
    const system = process.platform === "darwin" ? "aarch64-darwin" : "x86_64-linux";
    const result = await $({
      cwd: tmp,
      env: {
        ...process.env,
        BUCK_TARGET: "//projects/apps/rust-unsupported:rust-unsupported",
      },
      stdio: "pipe",
    })`nix build --impure --accept-flake-config --file viberoots/build-tools/tools/nix/graph-generator.nix selected --arg pkgs 'import <nixpkgs> {}' --arg src ./. --argstr system ${system} --arg graphJsonPath ${graphPath} --no-link --print-out-paths`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(
      String(result.stderr),
      /Rust planner link_deps contains unsupported target .* expected a native C\/C\+\+ library/,
    );
  });
});
