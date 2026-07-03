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

async function nixEvalFailure(tmp: string, $: any, expr: string) {
  const result = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`.nothrow();
  assert.notEqual(result.exitCode, 0);
  return String(result.stderr || "");
}

async function writeAltProfile(tmp: string) {
  await fs.outputFile(
    path.join(tmp, "fake-alt-nixpkgs", "default.nix"),
    [
      "{ system, ... }:",
      "let base = import <nixpkgs> { inherit system; };",
      "in base // {",
      '  profileprobe = { marker = "alt-profile-probe"; };',
      "}",
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

test("package pins resolve only pinned attrs from the pin profile", async () => {
  await runInTemp("nixpkgs-package-pin-resolution", async (tmp, $) => {
    await writeAltProfile(tmp);
    const expr = `
      ${sourceSelectionExpr()}
      let
        target = {
          name = "//projects/apps/demo:tool";
          nixpkgs_profile = "default";
          nixpkg_pins."pkgs.profileProbe" = {
            nixpkgs_profile = "alt";
            rationale = "Fixture package comes from alternate profile.";
          };
        };
        records = S.resolveNixpkgAttrs {
          inherit target;
          attrs = [ "pkgs.profileProbe" "pkgs.zlib" ];
        };
        pinned = builtins.elemAt records 0;
        unpinned = builtins.elemAt records 1;
      in {
        pinnedAttr = pinned.attr;
        pinnedProfile = pinned.profile_name;
        pinnedKind = pinned.resolution_kind;
        pinnedRationale = pinned.rationale;
        pinnedMarker = pinned.package.marker;
        unpinnedProfile = unpinned.profile_name;
        unpinnedKind = unpinned.resolution_kind;
        unpinnedIsDefaultZlib = unpinned.package.drvPath == pkgs.zlib.drvPath;
      }
    `;
    assert.deepEqual(await nixEvalJson(tmp, $, expr), {
      pinnedAttr: "pkgs.profileprobe",
      pinnedProfile: "alt",
      pinnedKind: "nixpkg_pin",
      pinnedRationale: "Fixture package comes from alternate profile.",
      pinnedMarker: "alt-profile-probe",
      unpinnedProfile: "default",
      unpinnedKind: "nixpkgs_profile",
      unpinnedIsDefaultZlib: true,
    });
  });
});

test("package pin diagnostics name missing rationale, unknown profile, and undeclared attrs", async () => {
  await runInTemp("nixpkgs-package-pin-diagnostics", async (tmp, $) => {
    await writeAltProfile(tmp);
    const missingRationale = await nixEvalFailure(
      tmp,
      $,
      `
        ${sourceSelectionExpr()}
        (S.sourcePlanFor {
          name = "//projects/apps/demo:tool";
          nixpkg_pins."pkgs.zlib".nixpkgs_profile = "alt";
        }).nixpkg_pins
      `,
    );
    assert.match(missingRationale, /nixpkg_pins\[pkgs\.zlib\]\.rationale/);
    assert.match(missingRationale, /\/\/projects\/apps\/demo:tool/);

    const unknownProfile = await nixEvalFailure(
      tmp,
      $,
      `
        ${sourceSelectionExpr()}
        (S.sourcePlanFor {
          name = "//projects/apps/demo:tool";
          nixpkg_pins."pkgs.zlib" = {
            nixpkgs_profile = "missing";
            rationale = "Exercise missing profile diagnostics.";
          };
        }).nixpkg_pins
      `,
    );
    assert.match(unknownProfile, /unknown profile missing/);
    assert.match(unknownProfile, /pkgs\.zlib/);
    assert.match(unknownProfile, /inline-registry\.nix/);

    const undeclared = await nixEvalFailure(
      tmp,
      $,
      `
        ${sourceSelectionExpr()}
        S.resolveNixpkgAttrs {
          target = {
            name = "//projects/apps/demo:tool";
            nixpkg_pins."pkgs.profileProbe" = {
              nixpkgs_profile = "alt";
              rationale = "Pin without declaring the package.";
            };
          };
          attrs = [ "pkgs.zlib" ];
        }
      `,
    );
    assert.match(undeclared, /undeclared nixpkg attrs: pkgs\.profileprobe/);
    assert.match(undeclared, /do not create dependencies/);
  });
});
