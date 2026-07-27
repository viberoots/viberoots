#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const sourceRoot = path.resolve(path.basename(process.cwd()) === "viberoots" ? "." : "viberoots");

test("interop selected-graph runtime uses immutable inputs under hostile worker state", async () => {
  const helper = await fs.readFile(
    path.join(sourceRoot, "build-tools/tools/tests/rust/rust.interop-runtime-helpers.ts"),
    "utf8",
  );
  const runtime = await fs.readFile(
    path.join(sourceRoot, "build-tools/tools/tests/rust/rust.crate-kinds.artifacts.test.ts"),
    "utf8",
  );
  const template = await fs.readFile(
    path.join(sourceRoot, "build-tools/tools/nix/templates/rust-interop.nix"),
    "utf8",
  );
  assert.match(helper, /exportGraphInTemp/);
  assert.match(helper, /buildCanonicalBundle/);
  assert.match(helper, /source-snapshot\.ts/);
  assert.match(helper, /materializeNixStorePaths/);
  assert.match(helper, /store add-path/);
  assert.match(helper, /PATH: "\/hostile"/);
  assert.match(helper, /CARGO_HOME:.*hostile-cargo/);
  assert.match(helper, /compile_error!\("ambient checkout must not enter remote replay"\)/);
  assert.doesNotMatch(helper, /--impure/);
  assert.doesNotMatch(helper, /--arg src/);
  assert.match(runtime, /env: hostileEnv.*appPath/s);
  assert.match(helper, /otool -D/);
  assert.match(helper, /librust_abi_rust_bridge/);
  assert.match(template, /generatorSources = builtins\.path/);
  assert.match(template, /rust-interop-generate\.mjs.*rust-interop-schema\.mjs/s);
});

test("Rust interop follows the repository supported-system matrix structurally", async () => {
  const matrix = await fs.readFile(
    path.join(sourceRoot, "build-tools/tools/nix/flake/for-all-systems.nix"),
    "utf8",
  );
  for (const system of ["aarch64-darwin", "aarch64-linux", "x86_64-linux"]) {
    assert.match(matrix, new RegExp(`"${system}"`));
  }
  assert.match(matrix, /systems = \[ "aarch64-darwin" "aarch64-linux" "x86_64-linux" \];/);
  assert.doesNotMatch(matrix, /"x86_64-darwin"|"i686-linux"/);
  const design = await fs.readFile(
    path.join(sourceRoot, "build-tools/docs/lang/rust-design.md"),
    "utf8",
  );
  assert.match(design, /other configured systems remain structural fail-closed matrix evidence/);
  assert.match(design, /does not claim a production remote worker/);
});
