#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("lang-helpers: python patch map helper matches inline defaults", async () => {
  await runInTemp("python-patches-map-helper", async (tmp, $) => {
    const d = path.join(tmp, "patches", "python");
    await fsp.mkdir(d, { recursive: true });

    const files = [
      "requests@2.32.3-1.patch",
      "@scope__name@1.2.3.patch",
      "pkg__name@0.9.0-alpha.1.patch",
    ];
    await Promise.all(files.map((f, idx) => fsp.writeFile(path.join(d, f), `# ${idx}\n`, "utf8")));

    const expr = `
      let
        pkgs = import <nixpkgs> {};
        lib = pkgs.lib;
        H = import ./build-tools/tools/nix/lib/lang-helpers.nix { inherit pkgs; };
        d = builtins.toPath ${JSON.stringify(d)};
      in {
        helper = H.pythonPatchesMapFromDirs { dirs = [ d ]; };
        inline = H.patchesMapFromDirsWith {
          dirs = [ d ];
          normalizeVersion = (v: lib.head (lib.splitString "-" v));
          namePrefix = "py-patch";
          materialize = true;
        };
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const parsed = JSON.parse(String(stdout || "{}")) as {
      helper: Record<string, string[]>;
      inline: Record<string, string[]>;
    };

    assert.deepEqual(parsed.helper, parsed.inline);

    const vals = Object.values(parsed.helper || {}).flat();
    assert.ok(vals.length > 0);
    assert.ok(vals.some((p) => typeof p === "string" && p.startsWith("/nix/store/")));
  });
});
