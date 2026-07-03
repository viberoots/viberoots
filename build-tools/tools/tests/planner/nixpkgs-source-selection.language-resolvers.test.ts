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

function plannerContext(repoRoot: string, nixpkgsPath: string, nodesExpr: string): string {
  return `
    let
      pkgs = import ${nixpkgsPath} {};
      lib = pkgs.lib;
      repoRoot = ${repoRoot};
      nodes = ${nodesExpr};
      get = attrs: k: attrs.\${k} or null;
      pkgPathOf = name: ".";
      resolveNixpkgAttrs = { target, attrs }:
        map (attr: {
          inherit attr;
          profile_name = target.nixpkgs_profile or "default";
          package = { marker = attr; profile = target.nixpkgs_profile or "default"; };
        }) attrs;
    in
  `;
}

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
