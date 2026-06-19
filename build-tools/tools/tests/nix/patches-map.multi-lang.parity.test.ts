#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function normalizePythonKey(key: string): string {
  const at = key.lastIndexOf("@");
  if (at <= 0 || at === key.length - 1) return key.toLowerCase();
  const name = key.slice(0, at);
  const version = key.slice(at + 1);
  const norm = version.split("-")[0] || "";
  return `${name}@${norm}`.toLowerCase();
}

test("lang-helpers: patch map parity across go and python modes", async () => {
  await runInTemp("nix-patches-map-multi-lang", async (tmp, $) => {
    const d = path.join(tmp, "patches", "go");
    await fsp.mkdir(d, { recursive: true });

    const files = [
      "github.com__acme__widget@v1.2.3.patch",
      "requests@2.32.3-1.patch",
      "@scope__name@1.2.3.patch",
    ];
    await Promise.all(files.map((f, idx) => fsp.writeFile(path.join(d, f), `# ${idx}\n`, "utf8")));

    const expr = `
      let
        pkgs = import <nixpkgs> {};
        lib = pkgs.lib;
        H = import ./viberoots/build-tools/tools/nix/lib/lang-helpers.nix { inherit pkgs; };
        d = builtins.toPath ${JSON.stringify(d)};
      in {
        go = H.patchesMapFromDirsWith { dirs = [ d ]; };
        python = H.patchesMapFromDirsWith {
          dirs = [ d ];
          normalizeVersion = (v: lib.head (lib.splitString "-" v));
          namePrefix = "py-patch";
          materialize = false;
        };
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const parsed = JSON.parse(String(stdout || "{}")) as {
      go: Record<string, string[]>;
      python: Record<string, string[]>;
    };

    const goKeys = Object.keys(parsed.go || {}).sort();
    const pyKeys = Object.keys(parsed.python || {}).sort();
    const normGoKeys = goKeys.map(normalizePythonKey).sort();

    assert.deepEqual(pyKeys, normGoKeys);

    const pyVals = Object.values(parsed.python || {}).flat();
    assert.ok(pyVals.length > 0);
    assert.ok(pyVals.every((p) => typeof p === "string" && p.endsWith(".patch")));
  });
});
