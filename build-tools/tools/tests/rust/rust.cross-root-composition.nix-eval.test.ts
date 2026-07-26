#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { copyViberootsSourcePath } from "../lib/test-helpers/source-paths";

type Case = {
  appDependency?: string;
  appDeps?: string[];
  coreDependency?: string;
  expected?: RegExp;
};

test("Rust composition validates Buck and Cargo path dependency agreement", async () => {
  await runInTemp("rust-composition-contract", async (tmp, $) => {
    for (const relative of [
      "viberoots/build-tools/tools/nix/planner/lib.nix",
      "viberoots/build-tools/tools/nix/planner/rust.nix",
      "viberoots/build-tools/tools/nix/planner/rust-composition.nix",
      "viberoots/build-tools/tools/nix/planner/rust-semver.nix",
    ]) {
      await copyViberootsSourcePath(relative, path.join(tmp, relative));
    }
    const root = (name: string) => path.join(tmp, "projects", name);
    for (const name of ["app", "core"]) {
      await fsp.mkdir(path.join(root(name), "src"), { recursive: true });
      await fsp.writeFile(
        path.join(root(name), "Cargo.lock"),
        `version = 3\n\n[[package]]\nname = "${name}"\nversion = "0.1.0"\n`,
      );
    }

    const evaluate = async ({
      appDependency = 'core = { path = "../core", version = "0.1" }',
      appDeps = ["root//projects/core:core"],
      coreDependency = "",
      expected,
    }: Case) => {
      await fsp.writeFile(
        path.join(root("app"), "Cargo.toml"),
        `[package]\nname="app"\nversion="0.1.0"\n[dependencies]\n${appDependency}\n`,
      );
      await fsp.writeFile(
        path.join(root("core"), "Cargo.toml"),
        `[package]\nname="core"\nversion="0.1.0"\n[dependencies]\n${coreDependency}\n`,
      );
      const deps = appDeps.map(JSON.stringify).join(" ");
      const expr = `
        let
          pkgs = import <nixpkgs> {};
          lib = pkgs.lib;
          app = {
            name = "root//projects/app:app"; rule_type = "rust_nix_build";
            labels = [ "lang:rust" "kind:bin" ]; deps = [ ${deps} ];
            cargo_manifest = "Cargo.toml"; cargo_lock = "Cargo.lock";
            crate = "app"; public_crate = "app"; crate_type = "bin";
            host_role = "target"; features = []; default_features = true;
            profile = "release"; target = ""; local_patch_dirs = [];
          };
          core = {
            name = "root//projects/core:core"; rule_type = "rust_nix_build";
            labels = [ "lang:rust" "kind:lib" ];
            deps = ${coreDependency ? '[ "root//projects/app:app" ]' : "[]"};
            cargo_manifest = "Cargo.toml"; cargo_lock = "Cargo.lock";
            crate = "core"; public_crate = "core"; crate_type = "rlib";
            host_role = "target"; features = []; default_features = true;
            profile = "release"; target = ""; local_patch_dirs = [];
          };
          ctx = {
            get = attrs: key: if builtins.hasAttr key attrs then attrs.\${key} else null;
            nodes = [ app core ];
            pkgPathOf = name: if name == app.name then "projects/app" else "projects/core";
            repoRootStr = ${JSON.stringify(tmp)};
            resolveNixpkgAttrs = _: [];
            sourcePlanFor = _: { base_pkgs = pkgs; nixpkgs_profile = "default"; nixpkg_pins = {}; };
            T.rustForPkgs = _: { rustPackage = args: {
              inherit (args.sourceComposition) diagnostics manifest digest;
            }; };
          };
          plugin = (import ./viberoots/build-tools/tools/nix/planner/rust.nix { inherit lib; }) ctx;
        in plugin.mkApp app.name
      `;
      const result = await $({ cwd: tmp, stdio: "pipe", reject: false, nothrow: true })`
        nix eval --impure --expr ${expr} --json
      `;
      if (expected) {
        assert.notEqual(result.exitCode, 0);
        assert.match(String(result.stderr), expected);
      } else {
        assert.equal(result.exitCode, 0, String(result.stderr || result.stdout));
        const composition = JSON.parse(String(result.stdout));
        assert.match(JSON.stringify(composition.diagnostics), /core@0\.1\.0/);
        assert.deepEqual(
          composition.manifest.map((record: { cargo_root: string }) => record.cargo_root),
          ["projects/app", "projects/core"],
        );
        assert.match(composition.digest, /^[0-9a-f]{64}$/);
      }
    };

    await evaluate({});
    await evaluate({
      appDeps: [],
      expected: /points outside the declared Rust source closure/,
    });
    await evaluate({
      appDependency: "",
      expected: /Buck dependencies without matching Cargo path dependencies/,
    });
    await evaluate({
      appDependency: 'core = { path = "../core", version = "2" }',
      expected: /version 2 is incompatible with 0\.1\.0/,
    });
    await evaluate({
      appDependency: 'core = { path = "../../outside", version = "0.1" }',
      expected: /points outside the declared Rust source closure/,
    });
    await evaluate({
      coreDependency: 'app = { path = "../app", version = "0.1" }',
      expected: /cross-root dependency cycle/,
    });
  });
});
