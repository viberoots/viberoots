#!/usr/bin/env zx-wrapper
// Verifies Starlark sanitize_name matches Nix/TS sanitizer
import { sanitizeName } from "../../lib/sanitize";
import { buckCommandEnv, isBuckDaemonInitTransient } from "../../lib/buck-command-env";

const cases: Array<{ name: string; value: string }> = [
  { name: "case1", value: "//projects/apps/foo:bin" },
  { name: "case2", value: "//projects/apps/foo/sub:my bin" },
  { name: "case3", value: "//third_party/providers:mod_ABC" },
  { name: "case4", value: "//a:b/c" },
  { name: "case5", value: "//UPPER:Case With Spaces" },
  { name: "case6", value: "root//projects/apps/foo:bin (config//toolchains:clang)" },
];

async function starlarkProbeOutput(target: string): Promise<string> {
  const inherited = String(
    process.env.BUCK_ISOLATION_DIR || process.env.BUCK_NESTED_ISO || "",
  ).trim();
  const iso = inherited || `sanitize_${process.pid}`;
  const runBuck = async (mode: "build" | "show-output") =>
    mode === "build"
      ? await $({ env: buckCommandEnv() })`buck2 --isolation-dir ${iso} build ${target}`
      : await $({
          env: buckCommandEnv(),
        })`buck2 --isolation-dir ${iso} targets --show-output ${target}`;

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

  try {
    await withTransientRetry(async () => await runBuck("build"));
    const { stdout } = await withTransientRetry(async () => await runBuck("show-output"));
    const out =
      String(stdout || "")
        .trim()
        .split(/\s+/)
        .pop() || "";
    const outName = out.split("/").pop() || "";
    if (!outName) throw new Error("no output path for " + target);
    return outName.replace(/\.txt$/, "");
  } finally {
    if (!inherited) {
      await $({
        env: buckCommandEnv(),
        reject: false,
        stdio: "ignore",
      })`buck2 --isolation-dir ${iso} kill`;
    }
  }
}

for (const c of cases) {
  const target = `viberoots//build-tools/tools/tests/lang/sanitize:${c.name}`;
  const want = sanitizeName(c.value);
  const got = await starlarkProbeOutput(target);
  if (got !== want) {
    console.error(`sanitize mismatch for ${c.value}: starlark='${got}' expected='${want}'`);
    process.exit(2);
  }
}

console.log("OK sanitize_name parity");
