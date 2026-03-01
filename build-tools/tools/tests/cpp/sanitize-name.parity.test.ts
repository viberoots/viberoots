#!/usr/bin/env zx-wrapper
// Verifies Starlark sanitize_name matches Nix H.sanitizeName
import { sanitizeName } from "../../lib/sanitize.ts";

const cases: Array<{ name: string; label: string }> = [
  { name: "case1", label: "//projects/apps/foo:bin" },
  { name: "case2", label: "//projects/apps/foo/sub:my bin" },
  { name: "case3", label: "//third_party/providers:mod_ABC" },
  { name: "case4", label: "//a:b/c" },
  { name: "case5", label: "//UPPER:Case With Spaces" },
  { name: "case6", label: "root//projects/apps/foo:bin (config//toolchains:clang)" },
];

const inheritedIso = String(
  process.env.BUCK_ISOLATION_DIR || process.env.BUCK_NESTED_ISO || "",
).trim();
const parityIso = inheritedIso || `parity_${process.pid}`;
const ownsIso = !inheritedIso;

async function starlarkProbeOutput(target: string): Promise<string> {
  await $`buck2 --isolation-dir ${parityIso} build ${target}`;
  const { stdout } = await $`buck2 --isolation-dir ${parityIso} targets --show-output ${target}`;
  const out = stdout.trim().split(/\s+/).pop() || "";
  const outName = out.split("/").pop() || "";
  if (!outName) throw new Error("no output path for " + target);
  return outName.replace(/\.txt$/, "");
}

try {
  for (const c of cases) {
    const target = `//build-tools/tools/tests/cpp/sanitize:${c.name}`;
    const want = sanitizeName(c.label);
    const got = await starlarkProbeOutput(target);
    if (got !== want) {
      console.error(`sanitize mismatch for ${c.label}: starlark='${got}' nix='${want}'`);
      process.exit(2);
    }
  }
} finally {
  if (ownsIso) {
    await $({
      reject: false,
      stdio: "ignore",
    })`buck2 --isolation-dir ${parityIso} kill`;
  }
}

console.log("OK sanitize parity");
