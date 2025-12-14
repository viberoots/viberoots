#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("lang-helpers: patchesMapFromDir decodes patch keys strictly (__ -> /)", async () => {
  await runInTemp("nix-patches-map-decode", async (tmp, $) => {
    const d = path.join(tmp, "patches", "go");
    await fsp.mkdir(d, { recursive: true });

    await fsp.writeFile(path.join(d, "lodash___core@4.17.21.patch"), "# a\n", "utf8");
    await fsp.writeFile(path.join(d, "foo@bar@1.0.0.patch"), "# b\n", "utf8");
    await fsp.writeFile(path.join(d, "github.com____acme__widget@v1.2.3.patch"), "# c\n", "utf8");

    const expr = `
      let
        pkgs = import <nixpkgs> {};
        H = import ./tools/nix/lib/lang-helpers.nix { inherit pkgs; };
      in builtins.attrNames (H.patchesMapFromDir (builtins.toPath ${JSON.stringify(d)}))
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const keys = JSON.parse(String(stdout || "[]")) as string[];
    keys.sort();

    assert.ok(keys.includes("lodash/_core@4.17.21"));
    assert.ok(keys.includes("foo@bar@1.0.0"));
    assert.ok(keys.includes("github.com//acme/widget@v1.2.3"));
  });
});
