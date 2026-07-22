#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { copyViberootsSourcePath } from "../lib/test-helpers/source-paths";

type PlannerFields = {
  cargo_manifest: string;
  cargo_lock: string;
  local_patch_dirs: string[];
};

test("rust planner rejects noncanonical Cargo metadata and patch traversal", async () => {
  await runInTemp("rust-planner-cargo-boundaries", async (tmp, $) => {
    for (const rel of [
      "viberoots/build-tools/tools/nix/planner/lib.nix",
      "viberoots/build-tools/tools/nix/planner/rust.nix",
    ]) {
      await copyViberootsSourcePath(rel, path.join(tmp, rel));
    }
    const cargoRoot = path.join(tmp, "projects/apps/rustapp");
    await fsp.mkdir(cargoRoot, { recursive: true });
    await fsp.writeFile(path.join(cargoRoot, "Cargo.toml"), "[package]\nname='rustapp'\n");
    await fsp.writeFile(path.join(cargoRoot, "Cargo.lock"), "version = 3\n");

    const evaluate = async (fields: PlannerFields) => {
      const patchDirs = fields.local_patch_dirs.map((value) => JSON.stringify(value)).join(" ");
      const expr = `
        let
          pkgs = import <nixpkgs> {};
          lib = pkgs.lib;
          node = {
            name = "root//projects/apps/rustapp:app";
            rule_type = "rust_nix_build";
            labels = [ "lang:rust" "kind:bin" ];
            deps = [];
            cargo_manifest = ${JSON.stringify(fields.cargo_manifest)};
            cargo_lock = ${JSON.stringify(fields.cargo_lock)};
            crate = "rustapp";
            features = [];
            default_features = true;
            profile = "release";
            target = "";
            local_patch_dirs = [ ${patchDirs} ];
          };
          ctx = {
            get = attrs: key: if builtins.hasAttr key attrs then attrs.\${key} else null;
            nodes = [ node ];
            pkgPathOf = _: "projects/apps/rustapp";
            repoRootStr = ${JSON.stringify(tmp)};
            resolveNixpkgAttrs = _: [];
            sourcePlanFor = _: { base_pkgs = pkgs; nixpkgs_profile = "default"; nixpkg_pins = {}; };
            T.rustForPkgs = _: {
              rustPackage = args: {
                manifest = builtins.toString args.cargoManifest;
                lock = builtins.toString args.cargoLock;
                patches = map builtins.toString args.patchInputs;
              };
            };
          };
          plugin = (import ./viberoots/build-tools/tools/nix/planner/rust.nix { inherit lib; }) ctx;
        in plugin.mkApp node.name
      `;
      return await $({ cwd: tmp, stdio: "pipe", reject: false, nothrow: true })`
        nix eval --impure --expr ${expr} --json
      `;
    };

    const canonical = await evaluate({
      cargo_manifest: "root//projects/apps/rustapp/Cargo.toml",
      cargo_lock: "root//projects/apps/rustapp/Cargo.lock",
      local_patch_dirs: ["patches/rust"],
    });
    assert.equal(canonical.exitCode, 0, String(canonical.stderr || canonical.stdout));

    const alternateManifest = await evaluate({
      cargo_manifest: "root//projects/apps/rustapp/Alternate.toml",
      cargo_lock: "root//projects/apps/rustapp/Cargo.lock",
      local_patch_dirs: ["patches/rust"],
    });
    assert.notEqual(alternateManifest.exitCode, 0);
    assert.match(
      String(alternateManifest.stderr),
      /cargo_manifest must be canonical package-local/,
    );

    const crossRootLock = await evaluate({
      cargo_manifest: "root//projects/apps/rustapp/Cargo.toml",
      cargo_lock: "root//projects/libs/shared/Cargo.lock",
      local_patch_dirs: ["patches/rust"],
    });
    assert.notEqual(crossRootLock.exitCode, 0);
    assert.match(String(crossRootLock.stderr), /cargo_lock must be canonical package-local/);

    const patchTraversal = await evaluate({
      cargo_manifest: "root//projects/apps/rustapp/Cargo.toml",
      cargo_lock: "root//projects/apps/rustapp/Cargo.lock",
      local_patch_dirs: ["../shared/patches/rust"],
    });
    assert.notEqual(patchTraversal.exitCode, 0);
    assert.match(String(patchTraversal.stderr), /local_patch_dirs must remain within the package/);
  });
});
