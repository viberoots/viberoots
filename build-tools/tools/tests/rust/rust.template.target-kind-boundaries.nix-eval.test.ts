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

    for (const mismatch of [
      {
        kind: "wasm",
        target: "wasm32-wasip1",
        expected: /Rust template kind wasm requires target wasm32-unknown-unknown/,
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
  });
});
