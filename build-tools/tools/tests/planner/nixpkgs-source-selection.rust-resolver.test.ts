#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";
import {
  nixEvalJson,
  pinnedNixpkgsPath,
  plannerContext,
  sourceRoot,
} from "./nixpkgs-source-selection.test-helpers";

test("Rust build-script dependencies use the selected profile and pin resolver", async () => {
  await runInScratchTemp("nixpkgs-profile-rust-resolver", async (tmp, $) => {
    const nixpkgsPath = await pinnedNixpkgsPath($);
    const rustPlanner = path.join(sourceRoot, "build-tools", "tools", "nix", "planner", "rust.nix");
    await fs.mkdirp(path.join(tmp, "projects", "rust"));
    await fs.writeFile(
      path.join(tmp, "projects", "rust", "Cargo.toml"),
      "[package]\nname='app'\nversion='0.1.0'\n",
    );
    await fs.writeFile(path.join(tmp, "projects", "rust", "Cargo.lock"), "version = 3\n");
    const expr = `
      ${plannerContext(
        tmp,
        nixpkgsPath,
        `[
          {
            name = "//projects/rust:app";
            rule_type = "rust_binary";
            labels = [ "lang:rust" "kind:bin" "nixpkg:pkgs.xz" "nixpkg:pkgs.zlib" ];
            deps = [];
            srcs = [];
            cargo_manifest = "Cargo.toml";
            cargo_lock = "Cargo.lock";
            crate = "app";
            nixpkgs_profile = "alt";
            nixpkg_pins."pkgs.zlib" = {
              nixpkgs_profile = "pinned";
              rationale = "exercise the per-package source authority";
            };
          }
        ]`,
      )}
      let
        T.rustForPkgs = selectedPkgs: {
          rustPackage = args: {
            profile = args.sourcePlan.nixpkgs_profile;
            pins = args.sourcePlan.nixpkg_pins;
            dependencyProfiles = map (dependency: dependency.profile) args.nixpkgDeps;
            dependencyMarkers = map (dependency: dependency.marker) args.nixpkgDeps;
            selectedPkgsMarker = selectedPkgs.marker;
          };
        };
        resolveRustNixpkgAttrs = { target, attrs }:
          map (attr:
            let pin = target.nixpkg_pins.\${attr} or null;
            in {
              inherit attr;
              profile_name = if pin == null then target.nixpkgs_profile else pin.nixpkgs_profile;
              package = {
                marker = attr;
                profile = if pin == null then target.nixpkgs_profile else pin.nixpkgs_profile;
              };
            }
          ) attrs;
        Rust = (import ${rustPlanner} { inherit lib; }) {
          inherit T get nodes repoRoot pkgPathOf;
          resolveNixpkgAttrs = resolveRustNixpkgAttrs;
          repoRootStr = builtins.toString repoRoot;
          sourcePlanFor = target: {
            nixpkgs_profile = target.nixpkgs_profile;
            nixpkg_pins = target.nixpkg_pins;
            base_pkgs = { marker = target.nixpkgs_profile; };
          };
        };
      in Rust.mkApp "//projects/rust:app"
    `;
    assert.deepEqual(await nixEvalJson($, tmp, expr), {
      profile: "alt",
      pins: {
        "pkgs.zlib": {
          nixpkgs_profile: "pinned",
          rationale: "exercise the per-package source authority",
        },
      },
      dependencyProfiles: ["alt", "pinned"],
      dependencyMarkers: ["pkgs.xz", "pkgs.zlib"],
      selectedPkgsMarker: "alt",
    });
  });
});
