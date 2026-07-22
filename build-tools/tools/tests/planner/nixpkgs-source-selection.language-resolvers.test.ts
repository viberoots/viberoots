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

test("Go CGO selected paths resolve nixpkg attrs through the source-selection resolver", async () => {
  await runInScratchTemp("nixpkgs-profile-go-cgo-resolver", async (tmp, $) => {
    const nixpkgsPath = await pinnedNixpkgsPath($);
    const goPlanner = path.join(sourceRoot, "build-tools", "tools", "nix", "planner", "go.nix");
    const expr = `
      ${plannerContext(
        tmp,
        nixpkgsPath,
        `[
          {
            name = "//projects/go:app";
            rule_type = "go_binary";
            labels = [ "lang:go" "kind:bin" "cgo:enabled" "nixpkg:pkgs.profileProbe" ];
            deps = [];
            srcs = [];
            nixpkgs_profile = "alt";
          }
        ]`,
      )}
      let
        T.goApp = args: {
          rawAttrs = args.nixCgoAttrs;
          resolvedProfiles = map (p: p.profile) args.nixCgoPkgs;
          resolvedMarkers = map (p: p.marker) args.nixCgoPkgs;
        };
        T.goLib = args: args;
        T.goTest = args: args;
        T.goCArchive = args: args;
        T.cppLib = args: args;
        T.goTinyWasmLib = args: args;
        Go = (import ${goPlanner} { inherit lib; }) {
          inherit T get nodes repoRoot pkgPathOf resolveNixpkgAttrs;
          modulesTomlFor = name: null;
          localModuleOverrides = {};
        };
      in Go.mkApp "//projects/go:app"
    `;
    assert.deepEqual(await nixEvalJson($, tmp, expr), {
      rawAttrs: [],
      resolvedProfiles: ["alt"],
      resolvedMarkers: ["pkgs.profileProbe"],
    });
  });
});

test("Python pyext selected paths resolve nixpkg attrs through the source-selection resolver", async () => {
  await runInScratchTemp("nixpkgs-profile-python-pyext-resolver", async (tmp, $) => {
    const nixpkgsPath = await pinnedNixpkgsPath($);
    await fs.writeFile(path.join(tmp, "uv.lock"), "\n", "utf8");
    const pyPlanner = path.join(sourceRoot, "build-tools", "tools", "nix", "planner", "python.nix");
    const expr = `
      ${plannerContext(
        tmp,
        nixpkgsPath,
        `[
          {
            name = "//projects/py:ext";
            rule_type = "python_extension";
            labels = [ "lang:python" "kind:pyext" "nixpkg:pkgs.profileProbe" ];
            deps = [];
            srcs = [ "ext.cpp" ];
            module = "demo.ext";
            nixpkgs_profile = "alt";
          }
        ]`,
      )}
      let
        T.pyExt = args: {
          rawAttrs = args.nixCxxAttrs;
          resolvedProfiles = map (p: p.profile) args.nixCxxPkgs;
          resolvedMarkers = map (p: p.marker) args.nixCxxPkgs;
        };
        T.pyApp = args: args;
        T.pyLib = args: args;
        T.pyTest = args: args;
        T.pyWheelhouse = args: null;
        T.cppLib = args: args;
        T.cppHeaders = args: args;
        Py = (import ${pyPlanner} { inherit lib; }) {
          inherit T get nodes repoRoot pkgPathOf resolveNixpkgAttrs;
          repoRootStr = builtins.toString repoRoot;
        };
      in Py.mkPyExt "//projects/py:ext"
    `;
    assert.deepEqual(await nixEvalJson($, tmp, expr), {
      rawAttrs: [],
      resolvedProfiles: ["alt"],
      resolvedMarkers: ["pkgs.profileProbe"],
    });
  });
});

test("C++ Node addon selected paths resolve nixpkg attrs through the source-selection resolver", async () => {
  await runInScratchTemp("nixpkgs-profile-cpp-node-addon-resolver", async (tmp, $) => {
    const nixpkgsPath = await pinnedNixpkgsPath($);
    const cppPlanner = path.join(sourceRoot, "build-tools", "tools", "nix", "planner", "cpp.nix");
    const expr = `
      ${plannerContext(
        tmp,
        nixpkgsPath,
        `[
          {
            name = "//projects/node:addon";
            rule_type = "cpp_node_addon";
            labels = [ "lang:cpp" "kind:addon" "nixpkg:pkgs.profileProbe" ];
            deps = [];
            srcs = [];
            nixpkgs_profile = "alt";
          }
        ]`,
      )}
      let
        T.cppForPkgs = pkgsForProfile: {
          cppNodeAddon = args: {
            rawAttrs = args.nixCxxAttrs;
            nixpkgsProfile = args.nixpkgsProfile;
            resolvedProfiles = map (p: p.profile) args.nixCxxPkgs;
            resolvedMarkers = map (p: p.marker) args.nixCxxPkgs;
          };
        };
        Cpp = (import ${cppPlanner} { inherit lib; }) {
          inherit T get nodes repoRoot pkgPathOf resolveNixpkgAttrs;
          sourcePlanFor = target: {
            nixpkgs_profile = target.nixpkgs_profile or "default";
            nixpkg_pins = {};
            base_pkgs = pkgs;
          };
          modulesTomlFor = name: null;
        };
      in Cpp.mkAddon "//projects/node:addon"
    `;
    assert.deepEqual(await nixEvalJson($, tmp, expr), {
      rawAttrs: [],
      nixpkgsProfile: "alt",
      resolvedProfiles: ["alt"],
      resolvedMarkers: ["pkgs.profileProbe"],
    });
  });
});
