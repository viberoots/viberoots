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
  kind?: "bin" | "wasm" | "wasi";
  target?: string;
  wasm_abi?: string;
  wasm_target?: string;
  wasm_link_kind?: string;
  link_deps?: string[];
  header_deps?: string[];
  nixpkg_deps?: string[];
};

test("rust planner rejects noncanonical Cargo metadata and patch traversal", async () => {
  await runInTemp("rust-planner-cargo-boundaries", async (tmp, $) => {
    for (const rel of [
      "viberoots/build-tools/tools/nix/planner/lib.nix",
      "viberoots/build-tools/tools/nix/planner/rust.nix",
      "viberoots/build-tools/tools/nix/planner/rust-composition.nix",
    ]) {
      await copyViberootsSourcePath(rel, path.join(tmp, rel));
    }
    const cargoRoot = path.join(tmp, "projects/apps/rustapp");
    await fsp.mkdir(cargoRoot, { recursive: true });
    await fsp.writeFile(path.join(cargoRoot, "Cargo.toml"), "[package]\nname='rustapp'\n");
    await fsp.writeFile(path.join(cargoRoot, "Cargo.lock"), "version = 3\n");

    const evaluate = async (fields: PlannerFields) => {
      const kind = fields.kind || "bin";
      const target = fields.target || "";
      const wasmAbi = fields.wasm_abi ?? (kind === "wasi" ? "wasi" : kind === "wasm" ? "bare" : "");
      const wasmTarget =
        fields.wasm_target ??
        (kind === "wasi" ? "wasm32-wasip1" : kind === "wasm" ? "wasm32-unknown-unknown" : "");
      const wasmLinkKind =
        fields.wasm_link_kind ?? (kind === "wasi" || kind === "wasm" ? "module" : "");
      const patchDirs = fields.local_patch_dirs.map((value) => JSON.stringify(value)).join(" ");
      const linkDeps = (fields.link_deps || []).map((value) => JSON.stringify(value)).join(" ");
      const headerDeps = (fields.header_deps || []).map((value) => JSON.stringify(value)).join(" ");
      const nixpkgLabels = (fields.nixpkg_deps || [])
        .map((value) => JSON.stringify(`nixpkg:${value}`))
        .join(" ");
      const expr = `
        let
          pkgs = import <nixpkgs> {};
          lib = pkgs.lib;
          node = {
            name = "root//projects/apps/rustapp:app";
            rule_type = "rust_nix_build";
            labels = [ "lang:rust" "kind:${kind}" ${nixpkgLabels} ];
            deps = [];
            link_deps = [ ${linkDeps} ];
            header_deps = [ ${headerDeps} ];
            cargo_manifest = ${JSON.stringify(fields.cargo_manifest)};
            cargo_lock = ${JSON.stringify(fields.cargo_lock)};
            crate = "rustapp";
            features = [];
            default_features = true;
            profile = "release";
            target = ${JSON.stringify(target)};
            wasm_abi = ${JSON.stringify(wasmAbi)};
            wasm_target = ${JSON.stringify(wasmTarget)};
            wasm_link_kind = ${JSON.stringify(wasmLinkKind)};
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
                target = args.target;
              };
            };
          };
          plugin = (import ./viberoots/build-tools/tools/nix/planner/rust.nix { inherit lib; }) ctx;
        in plugin.${kind === "wasm" ? "mkWasm" : kind === "wasi" ? "mkWasi" : "mkApp"} node.name
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
    const nativeNixpkg = await evaluate({
      cargo_manifest: "root//projects/apps/rustapp/Cargo.toml",
      cargo_lock: "root//projects/apps/rustapp/Cargo.lock",
      local_patch_dirs: [],
      nixpkg_deps: ["pkgs.zlib"],
    });
    assert.equal(nativeNixpkg.exitCode, 0, String(nativeNixpkg.stderr || nativeNixpkg.stdout));

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

    for (const mismatch of [
      {
        kind: "wasm" as const,
        target: "wasm32-wasip1",
        expected: /Rust planner target .* kind wasm requires target wasm32-unknown-unknown/,
      },
      {
        kind: "wasi" as const,
        target: "wasm32-unknown-unknown",
        expected: /Rust planner target .* kind wasi requires target wasm32-wasip1/,
      },
    ]) {
      const result = await evaluate({
        cargo_manifest: "root//projects/apps/rustapp/Cargo.toml",
        cargo_lock: "root//projects/apps/rustapp/Cargo.lock",
        local_patch_dirs: [],
        kind: mismatch.kind,
        target: mismatch.target,
      });
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), mismatch.expected);
    }

    for (const unsupported of [
      {
        kind: "wasi" as const,
        target: "wasm32-wasip1",
        header_deps: ["root//projects/libs/native:headers"],
      },
      {
        kind: "wasm" as const,
        target: "wasm32-unknown-unknown",
        nixpkg_deps: ["pkgs.zlib"],
      },
      {
        kind: "wasi" as const,
        target: "wasm32-wasip1",
        nixpkg_deps: ["pkgs.openssl"],
      },
    ]) {
      const result = await evaluate({
        cargo_manifest: "root//projects/apps/rustapp/Cargo.toml",
        cargo_lock: "root//projects/apps/rustapp/Cargo.lock",
        local_patch_dirs: [],
        ...unsupported,
      });
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), /does not support header_deps or nixpkg dependencies/);
    }
  });
});
