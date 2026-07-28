#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { copyViberootsSourcePath } from "../lib/test-helpers/source-paths";

test("Rust template independently rejects WASM and WASI target mismatches", async () => {
  await runInTemp("rust-template-target-kind-boundaries", async (tmp, $) => {
    const template = "viberoots/build-tools/tools/nix/templates/rust.nix";
    await copyViberootsSourcePath(template, path.join(tmp, template));
    const contract = "viberoots/build-tools/tools/nix/templates/rust-contract.nix";
    await copyViberootsSourcePath(contract, path.join(tmp, contract));
    const wasmRustflags = "viberoots/build-tools/tools/nix/templates/rust-wasm-rustflags.nix";
    await copyViberootsSourcePath(wasmRustflags, path.join(tmp, wasmRustflags));
    const source = await fsp.readFile(path.join(tmp, template), "utf8");
    assert.match(source, /cp -R "\$src" source/);
    assert.match(source, /sourceRoot = "source\/\$\{cargoRootRel\}"/);
    assert.match(
      source,
      /artifactDir = if hostRole == "host" then "target\/\$\{cargoProfile\}" else targetDir/,
    );

    for (const mismatch of [
      {
        kind: "wasm",
        target: "wasm32-wasi",
        expected: /Rust template kind wasm requires target wasm32-unknown-unknown or wasm32-wasip1/,
      },
      {
        kind: "wasi",
        target: "wasm32-unknown-unknown",
        expected: /Rust template kind wasi requires target wasm32-wasip1/,
      },
    ]) {
      const expr = `
        let
          pkgs = import <nixpkgs> {};
          template = import ./viberoots/build-tools/tools/nix/templates/rust.nix { inherit pkgs; };
        in template.validateKindTarget ${JSON.stringify(mismatch.kind)} ${JSON.stringify(mismatch.target)}
      `;
      const result = await $({ cwd: tmp, stdio: "pipe", reject: false, nothrow: true })`
        nix eval --impure --expr ${expr} --raw
      `;
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), mismatch.expected);
    }
    for (const publicCrate of ["bad/name", "bad-name", "9bad", "bad$HOME", "bad name"]) {
      const expr = `
        let
          pkgs = import <nixpkgs> {};
          contract = import ./viberoots/build-tools/tools/nix/templates/rust-contract.nix {
            inherit (pkgs) lib;
          };
        in contract.validatePublicCrate ${JSON.stringify(publicCrate)}
      `;
      const result = await $({ cwd: tmp, stdio: "pipe", reject: false, nothrow: true })`
        nix eval --impure --expr ${expr} --raw
      `;
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), /publicCrate must match/);
    }
    for (const [abi, target] of [
      ["bare", "wasm32-unknown-unknown"],
      ["wasi", "wasm32-wasip1"],
    ]) {
      const expr = `
        let
          pkgs = import <nixpkgs> {};
          contract = import ./viberoots/build-tools/tools/nix/templates/rust-contract.nix {
            inherit (pkgs) lib;
          };
        in contract.validateWasmTarget "wasm" ${JSON.stringify(target)} {
          abi = ${JSON.stringify(abi)};
          target = ${JSON.stringify(target)};
        }
      `;
      assert.equal(
        (
          await $({ cwd: tmp, stdio: "pipe" })`nix eval --impure --expr ${expr} --json`
        ).stdout.trim(),
        "true",
      );
    }
    for (const [optimize, debug, expected] of [
      ["none", false, ["-C", "debuginfo=0", "-C", "opt-level=0"]],
      ["none", true, ["-C", "debuginfo=2", "-C", "opt-level=0"]],
      ["speed", false, ["-C", "debuginfo=0", "-C", "opt-level=2"]],
      ["speed", true, ["-C", "debuginfo=2", "-C", "opt-level=2"]],
      ["size", false, ["-C", "debuginfo=0", "-C", "opt-level=z"]],
      ["size", true, ["-C", "debuginfo=2", "-C", "opt-level=z"]],
    ] as const) {
      const expr = `
        let
          pkgs = import <nixpkgs> {};
          flags = import ./viberoots/build-tools/tools/nix/templates/rust-wasm-rustflags.nix {
            inherit (pkgs) lib;
            kind = "wasm_static";
            wasm = {
              optimize = ${JSON.stringify(optimize)};
              debug = ${debug};
            };
          };
        in flags
      `;
      assert.deepEqual(
        JSON.parse(
          (await $({ cwd: tmp, stdio: "pipe" })`nix eval --impure --expr ${expr} --json`).stdout,
        ),
        expected,
      );
    }
  });
});
