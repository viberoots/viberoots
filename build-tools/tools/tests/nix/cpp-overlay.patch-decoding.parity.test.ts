#!/usr/bin/env zx-wrapper
import test from "node:test";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { decodeNameVersionFromPatch } from "../../lib/providers";
import { runInTemp } from "../lib/test-helpers";

function expectedOverlayKeys(filenames: string[], versions: Record<string, string>): string[] {
  const keys = new Set<string>();
  for (const file of filenames) {
    const decoded = decodeNameVersionFromPatch(file);
    if (!decoded) continue;
    const at = decoded.lastIndexOf("@");
    if (at <= 0 || at === decoded.length - 1) continue;
    const importPath = decoded.slice(0, at);
    const version = decoded.slice(at + 1);
    const attrFull = importPath.replace(/\//g, ".");
    if (!attrFull.startsWith("pkgs.")) continue;
    const name = attrFull.replace(/^pkgs\./, "");
    if (versions[name] !== version) continue;
    keys.add(name);
    keys.add(`${name}_patched_src`);
  }
  return Array.from(keys).sort();
}

test("cpp overlay patch decoding matches canonical decoder", async () => {
  await runInTemp("nix-cpp-overlay-decode", async (tmp, $) => {
    const repoRoot = process.env.REPO_ROOT || process.cwd();
    const overlaySource = path.join(
      repoRoot,
      "viberoots",
      "build-tools",
      "tools",
      "nix",
      "overlays",
      "cpp-patches.nix",
    );
    const overlayDest = path.join(
      tmp,
      "viberoots",
      "build-tools",
      "tools",
      "nix",
      "overlays",
      "cpp-patches.nix",
    );
    await fsp.mkdir(path.dirname(overlayDest), { recursive: true });
    await fsp.copyFile(overlaySource, overlayDest);

    const patchDir = path.join(tmp, "viberoots", "patches", "cpp");
    await fsp.mkdir(patchDir, { recursive: true });

    const filenames = [
      "pkgs__zlib@1.2.11.patch",
      "pkgs__zlib@1.2.10.patch",
      "pkgs__openssl@3.2.0.patch",
      "pkgs__nope@9.9.9.patch",
      "missing-at-separator.patch",
      "pkgs__bad@.patch",
      "not-a-patch.txt",
    ];
    await Promise.all(
      filenames.map((name) => fsp.writeFile(path.join(patchDir, name), "# patch\n", "utf8")),
    );

    const versions = { zlib: "1.2.11", openssl: "3.2.0" };
    const expected = expectedOverlayKeys(filenames, versions);

    const expr = `
      let
        pkgs = import <nixpkgs> {};
        overlay = import ./viberoots/build-tools/tools/nix/overlays/cpp-patches.nix;
        final = pkgs // {
          applyPatches = { name, src, patches }: "patched-" + name;
        };
        mkPkg = version: {
          inherit version;
          src = "src";
          overrideAttrs = f:
            let old = { src = "src"; }; in { version = version; src = (f old).src; };
        };
        prev = {
          zlib = mkPkg "1.2.11";
          openssl = mkPkg "3.2.0";
        };
      in builtins.attrNames (overlay final prev)
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const keys = JSON.parse(String(stdout || "[]")) as string[];
    keys.sort();

    assert.deepEqual(keys, expected);
  });
});
