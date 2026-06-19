#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp: duplicate normalized link_closure_overrides keys fail fast", async () => {
  await runInTemp("cpp-link-closure-override-dup-keys", async (tmp, $) => {
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        lib = pkgs.lib;
        get = attrs: k: attrs.\${k} or null;
        cleanLabel = s:
          let parts = lib.splitString " (" s; in
            if (builtins.length parts) > 1 then (builtins.elemAt parts 0) else s;
        ensureStringList = _ctx: xs:
          if xs == null then []
          else if builtins.isList xs && builtins.all builtins.isString xs then xs
          else builtins.throw "expected list of strings";
        nodeOfName = _nm: null;
        H = import ./viberoots/build-tools/tools/nix/planner/cpp-link-helpers.nix {
          inherit lib get cleanLabel ensureStringList nodeOfName;
        };
        overrides = {
          "//projects/libs/core:core" = "transitive";
          "//projects/libs/core:core (config//normalized-dup)" = "direct";
        };
      in H.normalizeOverrides "demo" overrides
    `;
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      reject: false,
    })`nix eval --impure --expr ${expr} --json`;
    assert.notEqual(res.exitCode, 0, "expected nix eval to fail");
    const combined = `${res.stderr}\n${res.stdout}`;
    assert.match(
      combined,
      /normalized link_closure_overrides has duplicate keys/i,
      "expected duplicate key normalization error",
    );
  });
});
