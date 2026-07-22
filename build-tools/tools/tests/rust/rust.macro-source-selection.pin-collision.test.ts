#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("Rust macro analysis rejects normalized nixpkg pin collisions", async () => {
  await runInTemp("rust-pin-collision", async (tmp, $) => {
    const app = path.join(tmp, "projects", "apps", "rust-pin-collision");
    await fsp.mkdir(path.join(app, "src"), { recursive: true });
    await fsp.writeFile(path.join(app, "Cargo.toml"), '[package]\nname="app"\nversion="0.1.0"\n');
    await fsp.writeFile(path.join(app, "Cargo.lock"), "version = 3\n");
    await fsp.writeFile(path.join(app, "src", "main.rs"), "fn main() {}\n");
    await fsp.writeFile(
      path.join(app, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary")',
        "rust_binary(",
        '    name = "app",',
        '    srcs = ["src/main.rs"],',
        "    nixpkg_pins = {",
        '        "gtest": {"nixpkgs_profile": "default", "rationale": "first"},',
        '        "pkgs.gtest": {"nixpkgs_profile": "default", "rationale": "second"},',
        "    },",
        ")",
        "",
      ].join("\n"),
    );
    const result = await $({ cwd: tmp, stdio: "pipe", nothrow: true })`
      buck2 cquery --target-platforms //:no_cgo //projects/apps/rust-pin-collision:app
    `;
    assert.notEqual(result.exitCode, 0);
    assert.match(
      `${String(result.stderr || "")}\n${String(result.stdout || "")}`,
      /duplicate normalized nixpkg_pins key pkgs\.googletest/,
    );
  });
});
