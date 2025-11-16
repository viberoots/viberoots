#!/usr/bin/env zx-wrapper
import { normalizeNixAttr } from "../../lib/providers.ts";

const cases: Array<{ name: string; attr: string }> = [
  { name: "case1", attr: "gtest" },
  { name: "case2", attr: "pkgs.gtest" },
  { name: "case3", attr: "pkgs.openssl" },
  { name: "case4", attr: "pkgs.gnome.glib" },
];

async function starlarkProbeOutput(target: string): Promise[string] {
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

for (const c of cases) {
  const target = `//tools/tests/normalization:${c.name}`;
  const want = normalizeNixAttr(c.attr);
  const got = await starlarkProbeOutput(target);
  if (got !== want) {
    console.error(`normalize_nix_attr mismatch for '${c.attr}': starlark='${got}' ts='${want}'`);
    process.exit(2);
  }
}

console.log("OK normalization parity");
