#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function nixEvalJson(tmp: string, $: any, expr: string, env = {}) {
  const { stdout } = await $({
    cwd: tmp,
    env: { ...process.env, ...env },
  })`nix eval --impure --expr ${expr} --json`;
  return JSON.parse(String(stdout || "null"));
}

test("nixpkgs source registry accepts the default registry", async () => {
  await runInTemp("nixpkgs-source-registry-default", async (tmp, $) => {
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        registry = import ./viberoots/build-tools/tools/nix/nixpkgs-source-registry.nix {};
        S = import ./viberoots/build-tools/tools/nix/planner/source-selection.nix {
          inherit pkgs;
          lib = pkgs.lib;
          get = attrs: k: attrs.\${k} or null;
          registryInput = registry;
          registryPath = ./viberoots/build-tools/tools/nix/nixpkgs-source-registry.nix;
          selectedTargetName = "//projects/apps/demo:tool";
        };
      in {
        schemaVersion = S.nixpkgsRegistry.schemaVersion;
        profileNames = builtins.attrNames S.nixpkgsRegistry.profiles;
        defaultProfile = (S.sourcePlanFor {}).nixpkgs_profile;
      }
    `;
    assert.deepEqual(await nixEvalJson(tmp, $, expr), {
      schemaVersion: "nixpkgs-source-registry@1",
      profileNames: ["default"],
      defaultProfile: "default",
    });
  });
});

test("pkgsForProfile default preserves existing pkgs attr resolution", async () => {
  await runInTemp("nixpkgs-source-registry-default-pkgs", async (tmp, $) => {
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        registry = import ./viberoots/build-tools/tools/nix/nixpkgs-source-registry.nix {};
        S = import ./viberoots/build-tools/tools/nix/planner/source-selection.nix {
          inherit pkgs;
          lib = pkgs.lib;
          get = attrs: k: attrs.\${k} or null;
          registryInput = registry;
          registryPath = ./viberoots/build-tools/tools/nix/nixpkgs-source-registry.nix;
          selectedTargetName = "//projects/apps/demo:tool";
        };
        resolved = S.resolveNixpkgAttr { target = {}; attr = "pkgs.zlib"; };
      in {
        samePkg = (S.pkgsForProfile "default").zlib.drvPath == pkgs.zlib.drvPath;
        resolvedPkg = resolved.package.drvPath == pkgs.zlib.drvPath;
        profile = resolved.profile_name;
        kind = resolved.resolution_kind;
      }
    `;
    assert.deepEqual(await nixEvalJson(tmp, $, expr), {
      samePkg: true,
      resolvedPkg: true,
      profile: "default",
      kind: "nixpkgs_profile",
    });
  });
});

test("source registry diagnostics name unknown profiles and registry path", async () => {
  await runInTemp("nixpkgs-source-registry-unknown", async (tmp, $) => {
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        registry = import ./viberoots/build-tools/tools/nix/nixpkgs-source-registry.nix {};
        S = import ./viberoots/build-tools/tools/nix/planner/source-selection.nix {
          inherit pkgs;
          lib = pkgs.lib;
          get = attrs: k: attrs.\${k} or null;
          registryInput = registry;
          registryPath = ./viberoots/build-tools/tools/nix/nixpkgs-source-registry.nix;
          selectedTargetName = "//projects/apps/demo:tool";
        };
      in (S.sourcePlanFor { nixpkgs_profile = "missing"; }).nixpkgs_profile
    `;
    const result = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`.nothrow();
    assert.notEqual(result.exitCode, 0);
    const stderr = String(result.stderr || "");
    assert.match(stderr, /unknown profile missing/);
    assert.match(stderr, /\/\/projects\/apps\/demo:tool/);
    assert.match(stderr, /nixpkgs-source-registry\.nix/);
  });
});

test("source registry fails closed for malformed and missing registry inputs", async () => {
  await runInTemp("nixpkgs-source-registry-invalid", async (tmp, $) => {
    const badRegistry = path.join(tmp, "bad-registry.nix");
    await fs.writeFile(badRegistry, '{ schemaVersion = "wrong"; profiles.default = {}; }\n');
    const malformedExpr = `
      let
        pkgs = import <nixpkgs> {};
        S = import ./viberoots/build-tools/tools/nix/planner/source-selection.nix {
          inherit pkgs;
          lib = pkgs.lib;
          get = attrs: k: attrs.\${k} or null;
          registryPath = ./bad-registry.nix;
          selectedTargetName = "//projects/apps/demo:tool";
        };
      in S.nixpkgsRegistry.schemaVersion
    `;
    const malformed = await $({
      cwd: tmp,
    })`nix eval --impure --expr ${malformedExpr} --json`.nothrow();
    assert.notEqual(malformed.exitCode, 0);
    assert.match(String(malformed.stderr || ""), /unsupported schemaVersion wrong/);

    const missingExpr = `
      let
        pkgs = import <nixpkgs> {};
        S = import ./viberoots/build-tools/tools/nix/planner/source-selection.nix {
          inherit pkgs;
          lib = pkgs.lib;
          get = attrs: k: attrs.\${k} or null;
          registryPath = ./missing-registry.nix;
          selectedTargetName = "//projects/apps/demo:tool";
        };
      in S.nixpkgsRegistry.schemaVersion
    `;
    const missing = await $({ cwd: tmp })`nix eval --impure --expr ${missingExpr} --json`.nothrow();
    assert.notEqual(missing.exitCode, 0);
    const stderr = String(missing.stderr || "");
    assert.match(stderr, /nixpkgs source registry missing/);
    assert.match(stderr, /\/\/projects\/apps\/demo:tool/);
    assert.match(stderr, /missing-registry\.nix/);
  });
});

test("source registry diagnostics reject unsupported systems", async () => {
  await runInTemp("nixpkgs-source-registry-unsupported-system", async (tmp, $) => {
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        registry = {
          schemaVersion = "nixpkgs-source-registry@1";
          profiles.default = { supportedSystems = [ "x86_64-linux" ]; };
        };
        S = import ./viberoots/build-tools/tools/nix/planner/source-selection.nix {
          inherit pkgs;
          lib = pkgs.lib;
          get = attrs: k: attrs.\${k} or null;
          registryInput = registry;
          registryPath = ./inline-registry.nix;
          system = "aarch64-darwin";
          selectedTargetName = "//projects/apps/demo:tool";
        };
      in S.nixpkgsRegistry.profiles.default.supportedSystems
    `;
    const result = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(
      String(result.stderr || ""),
      /profile default does not support system aarch64-darwin/,
    );
  });
});

test("profile imports receive the selected system explicitly", async () => {
  await runInTemp("nixpkgs-source-registry-system", async (tmp, $) => {
    const fakeInput = path.join(tmp, "fake-nixpkgs");
    await fs.outputFile(
      path.join(fakeInput, "default.nix"),
      "{ system, ... }: { inherit system; zlib.drvPath = system; }\n",
    );
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        registry = {
          schemaVersion = "nixpkgs-source-registry@1";
          profiles.default = { supportedSystems = [ pkgs.stdenv.hostPlatform.system ]; };
          profiles.alt = {
            input = ./fake-nixpkgs;
            supportedSystems = [ pkgs.stdenv.hostPlatform.system ];
          };
        };
        S = import ./viberoots/build-tools/tools/nix/planner/source-selection.nix {
          inherit pkgs;
          lib = pkgs.lib;
          get = attrs: k: attrs.\${k} or null;
          registryInput = registry;
          registryPath = ./inline-registry.nix;
          selectedTargetName = "//projects/apps/demo:tool";
        };
      in (S.pkgsForProfile "alt").system
    `;
    const system = await nixEvalJson(tmp, $, expr, { NIXPKGS_PROFILE_SOURCE: "ignored" });
    assert.equal(typeof system, "string");
    assert.notEqual(system, "ignored");
  });
});
