#!/usr/bin/env zx-wrapper
// Verifies Starlark sanitize_name matches Nix/TS sanitizer
const cases: Array<{ name: string; value: string }> = [
  { name: "case1", value: "//apps/foo:bin" },
  { name: "case2", value: "//apps/foo/sub:my bin" },
  { name: "case3", value: "//third_party/providers:mod_ABC" },
  { name: "case4", value: "//a:b/c" },
  { name: "case5", value: "//UPPER:Case With Spaces" },
];

function expectedSanitize(s: string): string {
  return s.replaceAll("//", "").replaceAll(":", "-").replaceAll("/", "-").replaceAll(" ", "-");
}

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
  const want = expectedSanitize(c.value);
  const got = await starlarkProbeOutput(target);
  if (got !== want) {
    console.error(`sanitize mismatch for ${c.value}: starlark='${got}' expected='${want}'`);
    process.exit(2);
  }
}

console.log("OK sanitize_name parity");
