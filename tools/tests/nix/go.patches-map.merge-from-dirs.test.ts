#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("lang-helpers: patchesMapFromDirs merges per-dir maps preserving order", async () => {
  await runInTemp("go-patches-map-merge", async (tmp, $) => {
    const d1 = path.join(tmp, "pkg", "patches", "go");
    const d2 = path.join(tmp, "other", "patches", "go");
    await fsp.mkdir(d1, { recursive: true });
    await fsp.mkdir(d2, { recursive: true });

    const f11 = path.join(d1, "github.com__foo__bar@v1.0.0.patch");
    const f12 = path.join(d1, "github.com__baz__qux@v2.0.0.patch");
    const f21 = path.join(d2, "github.com__foo__bar@v1.0.0.patch");
    await fsp.writeFile(f11, "# a\n", "utf8");
    await fsp.writeFile(f12, "# b\n", "utf8");
    await fsp.writeFile(f21, "# c\n", "utf8");

    const expr = `
      let
        pkgs = import <nixpkgs> {};
        H = import ./tools/nix/lib/lang-helpers.nix { inherit pkgs; };
      in H.patchesMapFromDirs (map builtins.toPath [ ${JSON.stringify(d1)} ${JSON.stringify(d2)} ])
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const obj = JSON.parse(String(stdout || "{}"));
    const key = "github.com/foo/bar@v1.0.0";
    const list: string[] = obj[key] || [];
    assert.equal(Array.isArray(list), true);
    // Ensure both patches appear and in the order of dirs
    assert.equal(list.length, 2);
    assert.equal(list[0], f11);
    assert.equal(list[1], f21);
    // Another module included from d1
    assert.ok(Array.isArray(obj["github.com/baz/qux@v2.0.0"]));
  });
});
