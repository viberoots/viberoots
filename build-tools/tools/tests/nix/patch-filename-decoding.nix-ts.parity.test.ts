#!/usr/bin/env zx-wrapper
import test from "node:test";
import assert from "node:assert/strict";
import { decodeNameVersionFromPatch } from "../../lib/providers";

function normalizePythonVersionSegment(v: string): string {
  return String(v || "").split("-")[0] || "";
}

function normalizePatchKeyVersion(key: string, normalizeVersion: (v: string) => string): string {
  const at = key.lastIndexOf("@");
  if (at <= 0 || at === key.length - 1) return key;
  const name = key.slice(0, at);
  const version = key.slice(at + 1);
  return `${name}@${normalizeVersion(version)}`.toLowerCase();
}

test("patch filename decoding parity (TypeScript <-> Nix)", async () => {
  const filenames = [
    "lodash@4.17.21.patch",
    "@scope__name@1.2.3.patch",
    "lodash___core@4.17.21.patch",
    "foo@bar@1.0.0.patch",
    "PKGS__OPENSSL@3.2.0.patch",
    "requests@2.32.3-1.patch",
    "missing-at-separator.patch",
    "bad@.patch",
    "not-a-patch.txt",
  ];

  const expr = `
    let
      pkgs = import <nixpkgs> {};
      lib = pkgs.lib;
      H = import ./viberoots/build-tools/tools/nix/lib/lang-helpers.nix { inherit pkgs; };
      files = builtins.fromJSON ${JSON.stringify(JSON.stringify(filenames))};
      decode = n:
        let d = H.decodePatchFilename { name = n; }; in if d == null then null else d.key;
      decodePython = n:
        let
          d = H.decodePatchFilename {
            name = n;
            normalizeVersion = (v: lib.head (lib.splitString "-" v));
          };
        in if d == null then null else d.key;
    in {
      keys = map decode files;
      pythonKeys = map decodePython files;
    }
  `;

  const { stdout } = await $`nix eval --impure --expr ${expr} --json`;
  const parsed = JSON.parse(String(stdout || "{}")) as {
    keys: Array<string | null>;
    pythonKeys: Array<string | null>;
  };

  assert.equal(parsed.keys.length, filenames.length);
  assert.equal(parsed.pythonKeys.length, filenames.length);

  for (let i = 0; i < filenames.length; i++) {
    const file = filenames[i]!;
    const ts = decodeNameVersionFromPatch(file);
    const tsPython =
      ts === null ? null : normalizePatchKeyVersion(ts, normalizePythonVersionSegment);

    assert.equal(parsed.keys[i], ts, `strict decode mismatch for ${file}`);
    assert.equal(parsed.pythonKeys[i], tsPython, `python normalize decode mismatch for ${file}`);
  }
});
