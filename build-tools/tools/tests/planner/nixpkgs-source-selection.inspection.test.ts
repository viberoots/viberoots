#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function nixEvalJson(tmp: string, $: any, expr: string): Promise<unknown> {
  const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
  return JSON.parse(String(stdout || "null"));
}

async function writeAltProfile(tmp: string): Promise<void> {
  await fs.outputFile(
    path.join(tmp, "fake-alt-nixpkgs", "default.nix"),
    [
      "{ system, ... }:",
      "let base = import <nixpkgs> { inherit system; };",
      'in base // { profileprobe = { marker = "alt-profile-probe"; }; }',
      "",
    ].join("\n"),
    "utf8",
  );
}

function sourceSelectionExpr(): string {
  return `
    let
      pkgs = import <nixpkgs> {};
      registry = {
        schemaVersion = "nixpkgs-source-registry@1";
        profiles.default = {};
        profiles.alt = {
          input = ./fake-alt-nixpkgs;
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
    in
  `;
}

test("planner source-plan inspection names target, profile, attrs, profiles, and rationales", async () => {
  await runInTemp("nixpkgs-source-plan-inspection", async (tmp, $) => {
    await writeAltProfile(tmp);
    const expr = `
      ${sourceSelectionExpr()}
      S.inspectSourcePlan {
        target = {
          name = "//projects/apps/demo:tool";
          nixpkgs_profile = "default";
          nixpkg_pins."pkgs.profileProbe" = {
            nixpkgs_profile = "alt";
            rationale = "Fixture package comes from alternate profile.";
          };
        };
        attrs = [ "profileProbe" "pkgs.zlib" ];
      }
    `;
    assert.deepEqual(await nixEvalJson(tmp, $, expr), [
      "target=//projects/apps/demo:tool nixpkgs_profile=default nixpkg_pins=pkgs.profileprobe",
      "target=//projects/apps/demo:tool nixpkgs_profile=default attr=pkgs.profileprobe profile=alt resolution_kind=nixpkg_pin rationale='Fixture package comes from alternate profile.'",
      "target=//projects/apps/demo:tool nixpkgs_profile=default attr=pkgs.zlib profile=default resolution_kind=nixpkgs_profile",
    ]);
  });
});
