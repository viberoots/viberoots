#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("Rust vendor plan copies a null-composition Cargo root at the source root", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "rust-vendor-single-root-"));
  try {
    const sourceRoot =
      path.basename(process.cwd()) === "viberoots"
        ? process.cwd()
        : path.join(process.cwd(), "viberoots");
    const module = path.join(sourceRoot, "build-tools/tools/nix/templates/rust-vendor.nix");
    const cargoRoot = path.join(tmp, "projects", "single");
    await fsp.mkdir(path.join(cargoRoot, "src"), { recursive: true });
    await fsp.writeFile(
      path.join(cargoRoot, "Cargo.toml"),
      '[package]\nname="single"\nversion="0.1.0"\n',
    );
    await fsp.writeFile(path.join(cargoRoot, "Cargo.lock"), "version = 3\n");
    await fsp.writeFile(path.join(cargoRoot, "src", "lib.rs"), "pub fn value() {}\n");
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        cargoRoot = builtins.path {
          path = ${JSON.stringify(cargoRoot)};
          name = "rust-vendor-single-root-input";
        };
        plan = import ${JSON.stringify(module)} {
          inherit pkgs cargoRoot;
          cargoLock = cargoRoot + "/Cargo.lock";
          sourceComposition = null;
        };
      in plan.sourceWithVendor
    `;
    const output = execFileSync(
      "nix",
      ["build", "--impure", "--expr", expr, "--no-link", "--print-out-paths"],
      { cwd: tmp, encoding: "utf8" },
    ).trim();
    assert.equal(
      await fsp.readFile(path.join(output, "Cargo.toml"), "utf8"),
      await fsp.readFile(path.join(cargoRoot, "Cargo.toml"), "utf8"),
    );
    assert.equal(
      await fsp.readFile(path.join(output, "src", "lib.rs"), "utf8"),
      "pub fn value() {}\n",
    );
    await assert.rejects(fsp.access(path.join(output, "single", "Cargo.toml")), /ENOENT/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
