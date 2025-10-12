#!/usr/bin/env zx-wrapper
// Verifies Starlark _sanitize_to_bin_name matches Nix H.sanitizeName
const cases: Array<{ name: string; label: string }> = [
  { name: "case1", label: "//apps/foo:bin" },
  { name: "case2", label: "//apps/foo/sub:my bin" },
  { name: "case3", label: "//third_party/providers:mod_ABC" },
  { name: "case4", label: "//a:b/c" },
  { name: "case5", label: "//UPPER:Case With Spaces" },
];

function nixSanitize(s: string): string {
  return s.replaceAll("//", "").replaceAll(":", "-").replaceAll("/", "-").replaceAll(" ", "-");
}

async function starlarkProbeOutput(target: string, label: string): Promise<string> {
  const iso = `parity_${Date.now()}`;
  await $`buck2 --isolation-dir ${iso} build ${target}`;
  const { stdout } = await $`buck2 --isolation-dir ${iso} targets --show-output ${target}`;
  const out = stdout.trim().split(/\s+/).pop() || "";
  const outName = out.split("/").pop() || "";
  // The file content is the sanitized value; derive expected content from Nix sanitizer
  if (!outName) throw new Error("no output path for " + target);
  return outName.replace(/\.txt$/, "");
}

for (const c of cases) {
  const target = `//tools/tests/cpp/sanitize:${c.name}`;
  const want = nixSanitize(c.label);
  const got = await starlarkProbeOutput(target, c.label);
  if (got !== want) {
    console.error(`sanitize mismatch for ${c.label}: starlark='${got}' nix='${want}'`);
    process.exit(2);
  }
}

console.log("OK sanitize parity");
