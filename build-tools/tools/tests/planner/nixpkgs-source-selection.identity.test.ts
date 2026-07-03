#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function nixEvalJson(tmp: string, $: any, expr: string) {
  const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
  return JSON.parse(String(stdout || "null"));
}

async function nixEvalFailure(tmp: string, $: any, expr: string) {
  const result = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`.nothrow();
  assert.notEqual(result.exitCode, 0);
  return String(result.stderr || "");
}

function sourceSelectionExpr(extraArgs = "{}") {
  return `
    let
      pkgs = import <nixpkgs> {};
      registry = {
        schemaVersion = "nixpkgs-source-registry@1";
        profiles.default = {};
        profiles.alt = {
          input = <nixpkgs>;
          supportedSystems = [ pkgs.stdenv.hostPlatform.system ];
        };
      };
      S = import ./viberoots/build-tools/tools/nix/planner/source-selection.nix ({
        inherit pkgs;
        lib = pkgs.lib;
        get = attrs: k: attrs.\${k} or null;
        registryInput = registry;
        registryPath = ./inline-registry.nix;
        selectedTargetName = "//projects/apps/demo:tool";
      } // (${extraArgs}));
    in
  `;
}

test("nixpkg identity dedupe keeps same attrs from different profiles distinct", async () => {
  await runInTemp("nixpkgs-source-identity-dedupe", async (tmp, $) => {
    const expr = `
      ${sourceSelectionExpr()}
      let
        records = S.dedupeNixpkgRecords [
          {
            target_label = "//projects/apps/demo:tool";
            attr = "pkgs.zlib";
            profile_name = "default";
            resolution_kind = "nixpkgs_profile";
          }
          {
            target_label = "//projects/apps/demo:tool";
            attr = "pkgs.zlib";
            profile_name = "alt";
            resolution_kind = "nixpkgs_profile";
          }
          {
            target_label = "//projects/apps/demo:tool";
            attr = "pkgs.zlib";
            profile_name = "default";
            resolution_kind = "nixpkgs_profile";
          }
        ];
      in {
        identities = map (r: S.nixpkgIdentityKey r) records;
        profiles = map (r: r.profile_name) records;
      }
    `;
    assert.deepEqual(await nixEvalJson(tmp, $, expr), {
      identities: ["default::pkgs.zlib", "alt::pkgs.zlib"],
      profiles: ["default", "alt"],
    });
  });
});

test("nixpkg identity conflicts include target, attr, profile, and resolution kind", async () => {
  await runInTemp("nixpkgs-source-identity-conflict", async (tmp, $) => {
    const expr = `
      ${sourceSelectionExpr()}
      let
        records = S.dedupeNixpkgRecords [
          {
            target_label = "//projects/apps/demo:tool";
            attr = "pkgs.zlib";
            profile_name = "alt";
            resolution_kind = "nixpkgs_profile";
          }
          {
            target_label = "//projects/apps/demo:tool";
            attr = "pkgs.zlib";
            profile_name = "alt";
            resolution_kind = "nixpkg_pin";
          }
        ];
      in records
    `;
    const stderr = await nixEvalFailure(tmp, $, expr);
    assert.match(stderr, /conflicting nixpkg source resolution/);
    assert.match(stderr, /\/\/projects\/apps\/demo:tool/);
    assert.match(stderr, /pkgs\.zlib/);
    assert.match(stderr, /profile alt/);
    assert.match(stderr, /resolution_kind nixpkg_pin/);
  });
});

test("active dev overrides are rejected for non-default source plans", async () => {
  await runInTemp("nixpkgs-source-dev-override-policy", async (tmp, $) => {
    const expr = `
      ${sourceSelectionExpr(`{
        activeDevOverrideLanguages = [ "cpp" ];
        activeDevOverrideEnvs = [ "NIX_CPP_DEV_OVERRIDE_JSON" ];
      }`)}
      (S.sourcePlanFor {
        name = "//projects/apps/demo:tool";
        nixpkgs_profile = "alt";
      }).nixpkgs_profile
    `;
    const stderr = await nixEvalFailure(tmp, $, expr);
    assert.match(stderr, /dev overrides are not supported/);
    assert.match(stderr, /\/\/projects\/apps\/demo:tool/);
    assert.match(stderr, /nixpkgs_profile alt/);
    assert.match(stderr, /NIX_CPP_DEV_OVERRIDE_JSON/);
  });
});

test("default source plans keep existing dev override allowance", async () => {
  await runInTemp("nixpkgs-source-dev-override-default", async (tmp, $) => {
    const expr = `
      ${sourceSelectionExpr(`{
        activeDevOverrideLanguages = [ "cpp" ];
        activeDevOverrideEnvs = [ "NIX_CPP_DEV_OVERRIDE_JSON" ];
      }`)}
      (S.sourcePlanFor {
        name = "//projects/apps/demo:tool";
        nixpkgs_profile = "default";
      }).nixpkgs_profile
    `;
    assert.equal(await nixEvalJson(tmp, $, expr), "default");
  });
});
