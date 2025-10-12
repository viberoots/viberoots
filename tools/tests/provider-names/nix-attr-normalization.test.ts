#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeNixAttr, providerNameForNixAttr } from "../../lib/providers.ts";

test("normalizeNixAttr enforces pkgs. prefix, lowercases, and maps gtest", async () => {
  const cases: Array<[string, string]> = [
    ["zlib", "pkgs.zlib"],
    ["pkgs.ZLib", "pkgs.zlib"],
    [" pkgs.openssl ", "pkgs.openssl"],
    ["gtest", "pkgs.googletest"],
    ["pkgs.gtest", "pkgs.googletest"],
    ["pkgs.gnome.glib", "pkgs.gnome.glib"],
  ];
  for (const [inp, exp] of cases) {
    assert.equal(normalizeNixAttr(inp), exp, `normalizeNixAttr(${inp})`);
  }
});

test("providerNameForNixAttr derives stable provider names", async () => {
  const cases: Array<[string, string]> = [
    ["zlib", "//third_party/providers:nix_pkgs_pkgs_zlib"],
    ["pkgs.openssl", "//third_party/providers:nix_pkgs_pkgs_openssl"],
    ["pkgs.gnome.glib", "//third_party/providers:nix_pkgs_pkgs_gnome_glib"],
    ["gtest", "//third_party/providers:nix_pkgs_pkgs_googletest"],
  ];
  for (const [inp, fq] of cases) {
    const name = providerNameForNixAttr(inp);
    assert.ok(fq.endsWith(name), `fq provider endsWith name for ${inp}`);
  }
});
