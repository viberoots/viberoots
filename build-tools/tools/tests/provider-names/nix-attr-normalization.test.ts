#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeNixAttr } from "../../lib/providers.ts";

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
