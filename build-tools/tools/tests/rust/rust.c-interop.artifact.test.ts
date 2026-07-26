#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { normalizeTargetLabel } from "../../lib/labels";
import { reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers";

test("Rust consumes direct and transitive C link intent through Cargo build scripts", async () => {
  await runInTemp("rust-c-interop", async (tmp, $) => {
    const cpp = path.join(tmp, "projects/libs/c-interop");
    const rust = path.join(tmp, "projects/apps/rust-interop");
    await fs.mkdir(path.join(cpp, "src"), { recursive: true });
    await fs.mkdir(path.join(cpp, "include"), { recursive: true });
    await fs.mkdir(path.join(rust, "src"), { recursive: true });
    await fs.writeFile(
      path.join(cpp, "src/support.cpp"),
      'extern "C" int support_answer() { return 40; }\n',
    );
    await fs.writeFile(
      path.join(cpp, "src/answer.cpp"),
      '#include <answer.h>\nextern "C" int support_answer();\nextern "C" int c_answer() { return support_answer() + C_ANSWER_OFFSET; }\n',
    );
    await fs.writeFile(path.join(cpp, "include/answer.h"), "#define C_ANSWER_OFFSET 2\n");
    await fs.writeFile(
      path.join(cpp, "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_headers", "nix_cpp_library")',
        'nix_cpp_headers(name = "headers", srcs = ["include/answer.h"], labels = ["lang:cpp", "kind:headers"], visibility = ["PUBLIC"])',
        'nix_cpp_library(name = "support", srcs = ["src/support.cpp"], visibility = ["PUBLIC"])',
        'nix_cpp_library(name = "answer", srcs = ["src/answer.cpp"], header_deps = [":headers"], link_deps = [":support"], visibility = ["PUBLIC"])',
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(rust, "Cargo.toml"),
      [
        "[package]",
        'name = "rust_interop"',
        'version = "0.1.0"',
        'edition = "2021"',
        'build = "build.rs"',
        "",
        "[[bin]]",
        'name = "rust_interop"',
        'path = "src/main.rs"',
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(rust, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname = "rust_interop"\nversion = "0.1.0"\n',
    );
    await fs.writeFile(
      path.join(rust, "build.rs"),
      [
        "use std::{env, fs, path::Path};",
        "fn main() {",
        '  let paths = env::var("VIBEROOTS_RUST_LINK_LIBRARY_PATHS").expect("declared C libraries");',
        "  for directory in env::split_paths(&paths) {",
        '    println!("cargo:rustc-link-search=native={}", directory.display());',
        "    let mut archives = fs::read_dir(&directory).into_iter().flatten().flatten()",
        "      .map(|entry| entry.path()).collect::<Vec<_>>();",
        "    archives.sort();",
        "    for archive in archives {",
        '      if archive.extension().and_then(|v| v.to_str()) != Some("a") { continue; }',
        "      let stem = Path::new(&archive).file_stem().unwrap().to_str().unwrap();",
        '      println!("cargo:rustc-link-lib=static={}", stem.trim_start_matches("lib"));',
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(rust, "src/main.rs"),
      [
        'unsafe extern "C" { fn c_answer() -> i32; }',
        'fn main() { println!("{}", unsafe { c_answer() }); }',
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(rust, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary")',
        "rust_binary(",
        '    name = "rust_interop",',
        '    crate = "rust_interop",',
        '    srcs = ["build.rs", "src/main.rs"],',
        '    link_deps = ["//projects/libs/c-interop:answer", "//projects/libs/c-interop:answer"],',
        '    header_deps = ["//projects/libs/c-interop:headers", "//projects/libs/c-interop:headers"],',
        '    link_closure = "transitive",',
        '    link_closure_overrides = {"//projects/libs/c-interop:answer": "transitive"},',
        ")",
        "",
      ].join("\n"),
    );
    await reconcileTempDependencyInputs(tmp, $);
    const query = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms //:no_cgo //projects/apps/rust-interop:rust_interop --json --output-attribute deps`;
    const configured = Object.values(JSON.parse(String(query.stdout))) as Array<{
      deps?: string[];
    }>;
    assert.equal(configured.length, 1);
    const deps = (configured[0]?.deps || []).map((dep) => normalizeTargetLabel(dep));
    assert.deepEqual(deps, [
      "//projects/libs/c-interop:answer",
      "//projects/libs/c-interop:headers",
    ]);
    const built = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --show-output //projects/apps/rust-interop:rust_interop`;
    const row = String(built.stdout)
      .split("\n")
      .find((line) => line.includes("//projects/apps/rust-interop:rust_interop"));
    assert.ok(row, `missing Rust interop output: ${String(built.stdout)}`);
    const executable = path.resolve(tmp, row.trim().split(/\s+/)[1]);
    const result = await $({ stdio: "pipe" })`${executable}`;
    assert.equal(String(result.stdout).trim(), "42");
  });
});

test("Rust planner rejects unsupported dependency artifacts with a targeted diagnostic", async () => {
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
