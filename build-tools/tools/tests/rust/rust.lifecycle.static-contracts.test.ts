#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.join(process.cwd(), "viberoots");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

test("Rust native lifecycle has one source-plan, runner, and runnable authority", () => {
  const defs = read("build-tools/rust/defs.bzl");
  const runner = read("build-tools/rust/private/nix_test.bzl");
  const planner = read("build-tools/tools/nix/planner/rust.nix");
  const graphGenerator = read("build-tools/tools/nix/graph-generator.nix");
  const manifest = read("build-tools/tools/nix/planner/manifest.nix");
  assert.match(defs, /def rust_test/);
  assert.match(runner, /run_from_project_root = True/);
  assert.match(runner, /use_project_relative_paths = True/);
  assert.match(runner, /default_sec = 600/);
  assert.match(planner, /ctx\.sourcePlanFor node/);
  assert.match(planner, /ctx\.resolveNixpkgAttrs/);
  assert.match(graphGenerator, /binaryNames/);
  assert.match(graphGenerator, /kindOf \(builtins\.head matches\) == "bin"/);
  assert.match(manifest, /\) rustOutPaths/);
  assert.match(manifest, /native-bin/);
});

test("Rust is registered as a native prerequisite but remains disabled for scaffolding", () => {
  const manifest = JSON.parse(read("build-tools/tools/nix/langs.json"));
  const rust = manifest.languages.find((entry: { id?: string }) => entry.id === "rust");
  assert.ok(rust);
  assert.ok(!manifest.enabled.includes("rust"));
  assert.deepEqual(rust.kinds, ["bin", "lib", "test"]);
  assert.equal(rust.hermetic.status, "scaffold");
  assert.ok(fs.existsSync(path.join(root, rust.templatesDir.replace(/^viberoots\//, ""))));
  for (const requiredPath of rust.requiredPaths) {
    assert.ok(fs.existsSync(path.join(process.cwd(), requiredPath)), requiredPath);
  }
});

test("Rust native support claims only reviewed source-registry systems and withholds Linux execution", () => {
  const registry = read("build-tools/tools/nix/nixpkgs-source-registry.nix");
  const design = read("build-tools/docs/lang/rust-design.md");
  for (const system of ["aarch64-darwin", "aarch64-linux", "x86_64-linux"]) {
    assert.match(registry, new RegExp(`"${system}"`));
  }
  assert.match(design, /native execution evidence only for `aarch64-darwin`/);
  assert.match(design, /Linux support remains unclaimed/);
});
