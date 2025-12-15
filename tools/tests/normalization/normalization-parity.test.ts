#!/usr/bin/env zx-wrapper
import { normalizeNixAttr, decodeNameVersionFromPatch } from "../../lib/providers.ts";

const cases: Array<{ name: string; attr: string }> = [
  { name: "case1", attr: "gtest" },
  { name: "case2", attr: "pkgs.gtest" },
  { name: "case3", attr: "pkgs.openssl" },
  { name: "case4", attr: "pkgs.gnome.glib" },
  { name: "case5", attr: "zlib" },
  { name: "case6", attr: "pkgs.zlib" },
];

async function starlarkProbeOutput(target: string): Promise<string> {
  const inherited = process.env.BUCK_ISOLATION_DIR;
  const iso = inherited && inherited.trim() ? inherited : `parity_${process.pid}`;
  const createdOwnIso = !inherited;
  try {
    await $`buck2 --isolation-dir ${iso} build ${target}`;
    const { stdout } = await $`buck2 --isolation-dir ${iso} targets --show-output ${target}`;
    const out = stdout.trim().split(/\s+/).pop() || "";
    const outName: string = out.split("/").pop() || "";
    if (!outName) throw new Error("no output path for " + target);
    return outName.replace(/\.txt$/, "");
  } finally {
    if (createdOwnIso) {
      try {
        await $`buck2 --isolation-dir ${iso} kill`;
      } catch {}
    }
  }
}

async function nixNormalize(attr: string): Promise<string> {
  // Evaluate the repo's canonical Nix normalizer for parity with Starlark/TS.
  // Use --argstr to safely pass the attribute string.
  const expr =
    "with import <nixpkgs> {}; " +
    "(let H = import ./tools/nix/lib/lang-helpers.nix { inherit pkgs; }; in H.normalizeNixAttr a)";
  const { stdout } = await $`nix eval --impure --raw --expr ${expr} --argstr a ${attr}`;
  return stdout.trim();
}

for (const c of cases) {
  const target = `//tools/tests/normalization:${c.name}`;
  const want = normalizeNixAttr(c.attr);
  const got = await starlarkProbeOutput(target);
  if (got !== want) {
    console.error(`normalize_nix_attr mismatch for '${c.attr}': starlark='${got}' ts='${want}'`);
    process.exit(2);
  }
  // Also compare against Nix evaluation parity
  const nix = await nixNormalize(c.attr);
  if (nix !== want) {
    console.error(`normalize_nix_attr mismatch for '${c.attr}': nix='${nix}' ts='${want}'`);
    process.exit(2);
  }
}

console.log("OK normalization parity");

// Flat patch filename decoding (Go/Node) — ensure decode helper behavior on a small corpus
const patchCases: Array<{ file: string; expect: string | null }> = [
  { file: "lodash@4.17.21.patch", expect: "lodash@4.17.21" },
  { file: "@scope__name@1.2.3.patch", expect: "@scope/name@1.2.3" },
  { file: "lodash___core@4.17.21.patch", expect: "lodash/_core@4.17.21" },
  { file: "foo@bar@1.0.0.patch", expect: "foo@bar@1.0.0" },
  { file: "PKGS__OPENSSL@3.2.0.patch", expect: "pkgs/openssl@3.2.0" }, // liberal decoding of "__" and casing
  { file: "not-a-patch.txt", expect: null },
  { file: "bad@.patch", expect: null },
];

for (const t of patchCases) {
  const got = decodeNameVersionFromPatch(t.file);
  if (got !== (t.expect && t.expect.toLowerCase())) {
    console.error(
      `decodeNameVersionFromPatch mismatch for '${t.file}': got='${got}' want='${t.expect?.toLowerCase() ?? null}'`,
    );
    process.exit(2);
  }
}

console.log("OK patch filename decoding parity");
