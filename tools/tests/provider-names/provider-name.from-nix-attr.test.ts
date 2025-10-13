#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { providerNameForNixAttr } from "../../lib/providers.ts";

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
