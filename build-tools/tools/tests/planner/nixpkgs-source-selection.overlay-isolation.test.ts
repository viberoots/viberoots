#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function nixEvalJson(tmp: string, $: any, expr: string) {
  const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
  return JSON.parse(String(stdout || "null"));
}

async function writeOverlayAwareInput(tmp: string) {
  await fs.outputFile(
    path.join(tmp, "fake-nixpkgs", "default.nix"),
    [
      "{ system, overlays ? [], ... }:",
      "let",
      "  base = {",
      '    profileprobe = { marker = "input-profile-probe"; };',
      '    localonly = { marker = "input-local-only"; };',
      "  };",
      "in builtins.foldl' (acc: overlay: acc // (overlay acc acc)) base overlays",
      "",
    ].join("\n"),
    "utf8",
  );
}

function sourceSelectionExpr() {
  return `
    let
      pkgs = import <nixpkgs> {};
      registry = {
        schemaVersion = "nixpkgs-source-registry@1";
        profiles.default = {};
        profiles.base = {
          input = ./fake-nixpkgs;
          overlays = [ (final: prev: {
            profileprobe = { marker = "base-profile-overlay"; };
            localonly = { marker = "base-local-overlay"; };
          }) ];
          supportedSystems = [ pkgs.stdenv.hostPlatform.system ];
        };
        profiles.alt = {
          input = ./fake-nixpkgs;
          overlays = [ (final: prev: {
            profileprobe = { marker = "alt-profile-overlay"; };
            localonly = { marker = "alt-local-overlay"; };
          }) ];
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

test("profile-local overlays only affect packages resolved from that profile", async () => {
  await runInTemp("nixpkgs-profile-overlay-isolation", async (tmp, $) => {
    await writeOverlayAwareInput(tmp);
    const expr = `
      ${sourceSelectionExpr()}
      let
        target = {
          name = "//projects/apps/demo:tool";
          nixpkgs_profile = "base";
          nixpkg_pins."pkgs.profileProbe" = {
            nixpkgs_profile = "alt";
            rationale = "Exercise profile-local overlay isolation.";
          };
        };
        records = S.resolveNixpkgAttrs {
          inherit target;
          attrs = [ "pkgs.profileProbe" "pkgs.localOnly" ];
        };
        pinned = builtins.elemAt records 0;
        unpinned = builtins.elemAt records 1;
      in {
        pinnedProfile = pinned.profile_name;
        pinnedKind = pinned.resolution_kind;
        pinnedMarker = pinned.package.marker;
        unpinnedProfile = unpinned.profile_name;
        unpinnedKind = unpinned.resolution_kind;
        unpinnedMarker = unpinned.package.marker;
      }
    `;
    assert.deepEqual(await nixEvalJson(tmp, $, expr), {
      pinnedProfile: "alt",
      pinnedKind: "nixpkg_pin",
      pinnedMarker: "alt-profile-overlay",
      unpinnedProfile: "base",
      unpinnedKind: "nixpkgs_profile",
      unpinnedMarker: "base-local-overlay",
    });
  });
});
