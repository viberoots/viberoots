#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { rustPkgsExpression } from "./rust-nixpkgs-authority";

test("Rust derivation exports exact cargo_packages inspection metadata", async () => {
  await runInTemp("rust-cargo-metadata-inspection", async (tmp, $) => {
    const cargoRoot = path.join(tmp, "fixture");
    const manifest = path.join(cargoRoot, "Cargo.toml");
    const lock = path.join(cargoRoot, "Cargo.lock");
    const gitSource = `git+https://git.example/dep#${"b".repeat(40)}`;
    await fsp.mkdir(cargoRoot);
    await fsp.writeFile(manifest, '[package]\nname="fixture"\nversion="0.1.0"\n');
    await fsp.writeFile(
      lock,
      [
        "version=3",
        '[[package]]\nname="fixture"\nversion="0.1.0"',
        '[[package]]\nname="registry_dep"\nversion="1.2.3"',
        'source="registry+https://registry.example/private-index"\nchecksum="fixture"',
        '[[package]]\nname="git_dep"\nversion="2.3.4"',
        `source="${gitSource}"`,
        "",
      ].join("\n"),
    );
    const expression = `
      let
        authority = ${rustPkgsExpression};
        pkgs = authority // {
          viberootsRustPlatform = {
            buildRustPackage = args: args;
          };
        };
        template =
          import ./viberoots/build-tools/tools/nix/templates/rust.nix { inherit pkgs; };
        evaluated = template.rustPackage {
          name = "root//fixture:fixture";
          kind = "lib";
          cargoRoot = builtins.toPath ${JSON.stringify(cargoRoot)};
          cargoManifest = builtins.toPath ${JSON.stringify(manifest)};
          cargoLock = builtins.toPath ${JSON.stringify(lock)};
          crate = "fixture";
        };
      in evaluated.passthru.viberootsRust.cargo_packages
    `;
    const result = await $({ cwd: tmp, stdio: "pipe" })`
      nix eval --impure --json --expr ${expression}
    `;
    assert.deepEqual(JSON.parse(String(result.stdout || "[]")), [
      {
        checksum: "",
        dependencies: [],
        name: "fixture",
        version: "0.1.0",
        source: "workspace",
      },
      {
        checksum: "",
        dependencies: [],
        name: "git_dep",
        version: "2.3.4",
        source: gitSource,
      },
      {
        checksum: "fixture",
        dependencies: [],
        name: "registry_dep",
        version: "1.2.3",
        source: "registry+https://registry.example/private-index",
      },
    ]);
  });
});
