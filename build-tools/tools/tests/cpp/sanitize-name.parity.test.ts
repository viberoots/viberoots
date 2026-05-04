#!/usr/bin/env zx-wrapper
// Verifies Starlark sanitize_name matches Nix H.sanitizeName
import { sanitizeName } from "../../lib/sanitize";
import { buckCommandEnv, isBuckDaemonInitTransient } from "../../lib/buck-command-env";

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
  const runBuck = async (mode: "build" | "show-output") =>
    mode === "build"
      ? await $({ env: buckCommandEnv() })`buck2 --isolation-dir ${parityIso} build ${target}`
      : await $({
          env: buckCommandEnv(),
        })`buck2 --isolation-dir ${parityIso} targets --show-output ${target}`;

  const withTransientRetry = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isBuckDaemonInitTransient(msg)) throw err;
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      return await run();
    }
  };

  await withTransientRetry(async () => await runBuck("build"));
  const { stdout } = await withTransientRetry(async () => await runBuck("show-output"));
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
      env: buckCommandEnv(),
      reject: false,
      stdio: "ignore",
    })`buck2 --isolation-dir ${parityIso} kill`;
  }
}

console.log("OK sanitize parity");
