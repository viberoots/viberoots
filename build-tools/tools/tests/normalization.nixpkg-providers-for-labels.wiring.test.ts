#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { providersForLabels } from "../lib/labels";

test("providersForLabels maps nixpkg:<attr> to canonical nix provider target labels", () => {
  const labels = [
    "nixpkg:zlib",
    "nixpkg:pkgs.zlib",
    "nixpkg: pkgs.zlib ",
    "nixpkg:gtest",
    "nixpkg:pkgs.gtest",
    "nixpkg:pkgs.googletest",
    "nixpkg:pkgs.gnome.glib",
  ];

  const got = providersForLabels(labels);

  assert.ok(got.includes("//third_party/providers:nix_pkgs_zlib"));
  assert.ok(got.includes("//third_party/providers:nix_pkgs_googletest"));
  assert.ok(got.includes("//third_party/providers:nix_pkgs_gnome_glib"));
});
