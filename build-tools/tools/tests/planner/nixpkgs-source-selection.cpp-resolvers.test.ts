#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { pinnedNixpkgsOutPathExpr } from "../../lib/pinned-nixpkgs";
import { runInScratchTemp } from "../lib/test-helpers";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

async function pinnedNixpkgsPath($: any): Promise<string> {
  const expr = pinnedNixpkgsOutPathExpr(path.join(sourceRoot, "flake.lock"));
  const out = await $({
    stdio: "pipe",
  })`nix eval --impure --accept-flake-config --raw --expr ${expr}`;
  return String(out.stdout || "").trim();
}

async function nixEvalJson($: any, cwd: string, expr: string): Promise<any> {
  const out = await $({ cwd, stdio: "pipe" })`nix eval --impure --json --expr ${expr}`;
  return JSON.parse(String(out.stdout || "null"));
}

function plannerContext(repoRoot: string, nixpkgsPath: string, nodeExpr: string): string {
  return `
    let
      pkgs = import ${nixpkgsPath} {};
      lib = pkgs.lib;
      repoRoot = ${repoRoot};
      node = ${nodeExpr};
      nodes = [ node ];
      get = attrs: k: attrs.\${k} or null;
      byName = { "\${node.name}" = node; };
      resolveNixpkgAttrs = { target, attrs }:
        map (attr: {
          inherit attr;
          profile_name = target.nixpkgs_profile or "default";
          package = { marker = attr; profile = target.nixpkgs_profile or "default"; };
        }) attrs;
      cppTargets = ${path.join(sourceRoot, "build-tools", "tools", "nix", "planner", "cpp-targets.nix")};
      targetsFor = template: import cppTargets {
        inherit lib byName resolveNixpkgAttrs;
        T.cppForPkgs = profilePkgs: template;
        labelsOf = n: n.labels or [];
        linkModeOf = name: "static";
        pkgPathOf = name: ".";
        inherit repoRoot;
        normSrcsOf = name: [];
        patchInputsFor = name: [];
        collectNixAttrsFor = name: [ "pkgs.profileProbe" ];
        nixAttrsFromSelf = name: [ "pkgs.profileProbe" ];
        repoCppHeaderPkgsFor = name: [];
        repoCppLibPkgsFor = name: [];
        repoGoCArchivesFor = name: [];
        providerAttrsFallback = [];
        sourcePlanFor = target: {
          nixpkgs_profile = target.nixpkgs_profile or "default";
          nixpkg_pins = {};
          base_pkgs = pkgs;
        };
      };
    in
  `;
}

test("C++ test selected paths keep nixpkg attrs on the source-selection resolver", async () => {
  await runInScratchTemp("nixpkgs-profile-cpp-test-resolver", async (tmp, $) => {
    const nixpkgsPath = await pinnedNixpkgsPath($);
    const expr = `
      ${plannerContext(
        tmp,
        nixpkgsPath,
        `{
        name = "//projects/cpp:test";
        rule_type = "cxx_test";
        labels = [ "lang:cpp" "kind:test" "nixpkg:pkgs.profileProbe" ];
        deps = [];
        srcs = [];
        nixpkgs_profile = "alt";
      }`,
      )}
      let
        Targets = targetsFor {
          cppTest = args: {
            rawAttrs = args.nixCxxAttrs;
            attrNames = args.nixCxxAttrNames;
            nixpkgsProfile = args.nixpkgsProfile;
            resolvedProfiles = map (p: p.profile) args.nixCxxPkgs;
            resolvedMarkers = map (p: p.marker) args.nixCxxPkgs;
          };
        };
      in Targets.mkTest "//projects/cpp:test"
    `;
    assert.deepEqual(await nixEvalJson($, tmp, expr), {
      rawAttrs: [],
      attrNames: ["pkgs.profileProbe"],
      nixpkgsProfile: "alt",
      resolvedProfiles: ["alt"],
      resolvedMarkers: ["pkgs.profileProbe"],
    });
  });
});

test("C++ static wasm selected paths pass resolved profile packages into the wasm template", async () => {
  await runInScratchTemp("nixpkgs-profile-cpp-wasm-resolver", async (tmp, $) => {
    const nixpkgsPath = await pinnedNixpkgsPath($);
    const expr = `
      ${plannerContext(
        tmp,
        nixpkgsPath,
        `{
        name = "//projects/cpp:wasm";
        rule_type = "cxx_library";
        labels = [ "lang:cpp" "kind:lib" "flavor:wasm" "nixpkg:pkgs.profileProbe" ];
        deps = [];
        srcs = [];
        nixpkgs_profile = "alt";
      }`,
      )}
      let
        Targets = targetsFor {
          cppWasmStaticLib = args: {
            rawAttrs = args.nixCxxAttrs;
            nixpkgsProfile = args.nixpkgsProfile;
            resolvedProfiles = map (p: p.profile) args.nixCxxPkgs;
            resolvedMarkers = map (p: p.marker) args.nixCxxPkgs;
          };
        };
      in Targets.mkLib "//projects/cpp:wasm"
    `;
    assert.deepEqual(await nixEvalJson($, tmp, expr), {
      rawAttrs: [],
      nixpkgsProfile: "alt",
      resolvedProfiles: ["alt"],
      resolvedMarkers: ["pkgs.profileProbe"],
    });
  });
});

test("C++ static wasm template includes resolved nix package include paths", async () => {
  await runInScratchTemp("nixpkgs-profile-cpp-wasm-template", async (tmp, $) => {
    const nixpkgsPath = await pinnedNixpkgsPath($);
    await fs.ensureDir(path.join(tmp, "include-pkg", "include"));
    const wasmTemplate = path.join(
      sourceRoot,
      "build-tools",
      "tools",
      "nix",
      "templates",
      "cpp-wasm-lib.nix",
    );
    const expr = `
      let
        pkgs = import ${nixpkgsPath} {};
        T = import ${wasmTemplate} { inherit pkgs; };
        drv = T.cppWasmStaticLib {
          name = "//projects/cpp:wasm";
          srcRoot = ${tmp};
          subdir = ".";
          srcList = [];
          nixCxxPkgs = [ ${tmp}/include-pkg ];
          nixpkgsProfile = "alt";
        };
      in {
        hasResolvedInclude = pkgs.lib.hasInfix "-isystem " drv.installPhase && pkgs.lib.hasInfix "include-pkg/include" drv.installPhase;
        hasProfileDebug = pkgs.lib.hasInfix "nixpkgsProfile=alt" drv.installPhase;
      }
    `;
    assert.deepEqual(await nixEvalJson($, tmp, expr), {
      hasResolvedInclude: true,
      hasProfileDebug: true,
    });
  });
});
