#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import { decodeNameVersionFromPatch, normalizeNixAttr } from "../lib/providers.ts";

const cases: Array<{ name: string; attr: string }> = [
  { name: "case1", attr: "gtest" },
  { name: "case2", attr: "pkgs.gtest" },
  { name: "case3", attr: "pkgs.openssl" },
  { name: "case4", attr: "pkgs.gnome.glib" },
  { name: "case5", attr: "zlib" },
  { name: "case6", attr: "pkgs.zlib" },
];

function resolveBuckEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (!env.SSL_CERT_FILE) {
    const fromNix = env.NIX_SSL_CERT_FILE;
    if (fromNix) env.SSL_CERT_FILE = fromNix;
  }
  if (!env.SSL_CERT_FILE) {
    const defaultCert = "/nix/var/nix/profiles/default/etc/ssl/certs/ca-bundle.crt";
    try {
      if (fs.existsSync(defaultCert)) env.SSL_CERT_FILE = defaultCert;
    } catch {}
  }
  if (!env.SSL_CERT_DIR && env.NIX_SSL_CERT_DIR) {
    env.SSL_CERT_DIR = env.NIX_SSL_CERT_DIR;
  }
  return env;
}

async function starlarkProbeOutput(target: string): Promise<string> {
  const inherited = String(
    process.env.BUCK_ISOLATION_DIR || process.env.BUCK_NESTED_ISO || "",
  ).trim();
  const iso = inherited || `parity_${process.pid}`;
  const env = resolveBuckEnv();
  try {
    await $({ env })`buck2 --isolation-dir ${iso} build ${target}`;
    const { stdout } = await $({
      env,
    })`buck2 --isolation-dir ${iso} targets --show-output ${target}`;
    const out = stdout.trim().split(/\s+/).pop() || "";
    const outName: string = out.split("/").pop() || "";
    if (!outName) throw new Error("no output path for " + target);
    return outName.replace(/\.txt$/, "");
  } finally {
    // Let verify/test harness manage daemon lifecycle; avoid per-test cold-start churn.
  }
}

async function nixNormalize(attr: string): Promise<string> {
  const nixStringLiteral = JSON.stringify(String(attr ?? ""));
  const expr =
    "let pkgs = import <nixpkgs> {}; " +
    `H = import ./build-tools/tools/nix/lib/lang-helpers.nix { inherit pkgs; }; ` +
    `in H.normalizeNixAttr ${nixStringLiteral}`;
  const { stdout } = await $`nix eval --impure --raw --expr ${expr}`;
  return stdout.trim();
}

for (const c of cases) {
  const target = `//build-tools/tools/tests/normalization:${c.name}`;
  const want = normalizeNixAttr(c.attr);
  const got = await starlarkProbeOutput(target);
  if (got !== want) {
    console.error(`normalize_nix_attr mismatch for '${c.attr}': starlark='${got}' ts='${want}'`);
    process.exit(2);
  }
  const nix = await nixNormalize(c.attr);
  if (nix !== want) {
    console.error(`normalize_nix_attr mismatch for '${c.attr}': nix='${nix}' ts='${want}'`);
    process.exit(2);
  }
}

console.log("OK nixpkg normalization parity");

const patchCases: Array<{ file: string; expect: string | null }> = [
  { file: "lodash@4.17.21.patch", expect: "lodash@4.17.21" },
  { file: "@scope__name@1.2.3.patch", expect: "@scope/name@1.2.3" },
  { file: "lodash___core@4.17.21.patch", expect: "lodash/_core@4.17.21" },
  { file: "foo@bar@1.0.0.patch", expect: "foo@bar@1.0.0" },
  { file: "PKGS__OPENSSL@3.2.0.patch", expect: "pkgs/openssl@3.2.0" },
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
