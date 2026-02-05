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

async function starlarkProbeOutput(target: string, label: string): Promise<string> {
  const safeTarget = target.replace(/[^a-zA-Z0-9]+/g, "_");
  const iso = `parity_${process.pid}_${Date.now()}_${safeTarget}`;
  const createdOwnIso = true;
  try {
    await $`buck2 --isolation-dir ${iso} build ${target}`;
    const { stdout } = await $`buck2 --isolation-dir ${iso} targets --show-output ${target}`;
    const out = stdout.trim().split(/\s+/).pop() || "";
    const outName = out.split("/").pop() || "";
    // The file content is the sanitized value; derive expected content from Nix sanitizer
    if (!outName) throw new Error("no output path for " + target);
    return outName.replace(/\.txt$/, "");
  } finally {
    // If we created a custom isolation for this script, kill only that daemon.
    if (createdOwnIso) {
      try {
        await $`buck2 --isolation-dir ${iso} kill`;
      } catch {}
    }
  }
}

for (const c of cases) {
  const target = `//build-tools/tools/tests/cpp/sanitize:${c.name}`;
  const want = sanitizeName(c.label);
  const got = await starlarkProbeOutput(target, c.label);
  if (got !== want) {
    console.error(`sanitize mismatch for ${c.label}: starlark='${got}' nix='${want}'`);
    process.exit(2);
  }
}

console.log("OK sanitize parity");
