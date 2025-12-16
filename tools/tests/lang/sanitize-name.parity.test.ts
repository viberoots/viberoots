#!/usr/bin/env zx-wrapper
// Verifies Starlark sanitize_name matches Nix/TS sanitizer
import { sanitizeName } from "../../lib/sanitize.ts";

const cases: Array<{ name: string; value: string }> = [
  { name: "case1", value: "//apps/foo:bin" },
  { name: "case2", value: "//apps/foo/sub:my bin" },
  { name: "case3", value: "//third_party/providers:mod_ABC" },
  { name: "case4", value: "//a:b/c" },
  { name: "case5", value: "//UPPER:Case With Spaces" },
  { name: "case6", value: "root//apps/foo:bin (config//toolchains:clang)" },
];

async function starlarkProbeOutput(target: string): Promise<string> {
  const inherited = process.env.BUCK_ISOLATION_DIR;
  const iso = inherited && inherited.trim() ? inherited : `sanitize_${process.pid}`;
  const createdOwnIso = !inherited;
  try {
    await $`buck2 --isolation-dir ${iso} build ${target}`;
    const { stdout } = await $`buck2 --isolation-dir ${iso} targets --show-output ${target}`;
    const out =
      String(stdout || "")
        .trim()
        .split(/\s+/)
        .pop() || "";
    const outName = out.split("/").pop() || "";
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
  const target = `//tools/tests/lang/sanitize:${c.name}`;
  const want = sanitizeName(c.value);
  const got = await starlarkProbeOutput(target);
  if (got !== want) {
    console.error(`sanitize mismatch for ${c.value}: starlark='${got}' expected='${want}'`);
    process.exit(2);
  }
}

console.log("OK sanitize_name parity");
