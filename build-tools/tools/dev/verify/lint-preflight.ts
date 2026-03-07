import path from "node:path";
import process from "node:process";
import "zx/globals";
import { runNodeWithZx } from "../../lib/node-run.ts";

async function runVerifyFileSizePreflight(root: string, zxInitPath: string): Promise<void> {
  const script = path.resolve(root, "build-tools/tools/dev/file-size-lint.ts");
  const args = ["--scope=source", "--fail=true"];
  process.stderr.write("[verify] file-size preflight: running strict source-file size gate\n");
  try {
    await runNodeWithZx({ cwd: root, script, args, zxInitPath, stdio: "inherit" });
  } catch {
    process.stderr.write(
      "error: file-size preflight failed; split oversized source files and re-run 'v'\n",
    );
    process.exit(2);
  }
}

async function runVerifySsrTestFileSizePreflight(root: string, zxInitPath: string): Promise<void> {
  const script = path.resolve(root, "build-tools/tools/dev/file-size-lint.ts");
  const args = ["--scope=ssr-tests", "--fail=true"];
  process.stderr.write("[verify] file-size preflight: running strict SSR test-module size gate\n");
  try {
    await runNodeWithZx({ cwd: root, script, args, zxInitPath, stdio: "inherit" });
  } catch {
    process.stderr.write(
      "error: SSR test-module file-size preflight failed; split oversized SSR test files and re-run 'v'\n",
    );
    process.exit(2);
  }
}

async function runVerifyNixGapsPolicyPreflight(root: string, zxInitPath: string): Promise<void> {
  const script = path.resolve(root, "build-tools/tools/dev/nix-gaps-inventory-check.ts");
  const args = [
    "--starlark-api",
    "docs/handbook/starlark-api.md",
    "--nix-gaps",
    "docs/handbook/nix-gaps.md",
    "--exceptions",
    "docs/handbook/nix-gaps-exceptions.json",
  ];
  process.stderr.write(
    "[verify] nix-gaps policy preflight: running inventory + exception checks\n",
  );
  try {
    await runNodeWithZx({ cwd: root, script, args, zxInitPath, stdio: "inherit" });
  } catch {
    process.stderr.write(
      "error: nix-gaps policy preflight failed; update docs/policy files and re-run 'v'\n",
    );
    process.exit(2);
  }
}

export async function runVerifyLintPreflight(
  root: string,
  zxInitPath: string,
  opts: { lintFilters?: string[] | null; includeBuildSystemPolicy?: boolean } = {},
): Promise<void> {
  const includeBuildSystemPolicy = opts.includeBuildSystemPolicy !== false;
  const skipLint = (process.env.VERIFY_SKIP_LINT || "").trim() === "1";
  if (skipLint) {
    process.stderr.write("[verify] lint preflight: skipped (VERIFY_SKIP_LINT=1)\n");
    if (includeBuildSystemPolicy) {
      await runVerifyNixGapsPolicyPreflight(root, zxInitPath);
    } else {
      process.stderr.write(
        "[verify] nix-gaps policy preflight: skipped for projects-only verify scope\n",
      );
    }
    return;
  }

  const timeoutSecs = Number((process.env.VERIFY_LINT_TIMEOUT_SECS || "600").trim());
  const secs = Number.isFinite(timeoutSecs) && timeoutSecs > 0 ? Math.floor(timeoutSecs) : 600;

  const lintFilters = Array.isArray(opts.lintFilters)
    ? opts.lintFilters.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const scoped = lintFilters.length > 0;
  const lintCmd = scoped
    ? `pnpm exec eslint ${lintFilters.join(" ")} --ext .ts --max-warnings=0 --ignore-pattern buck-out --ignore-pattern coverage --ignore-pattern .clinic --ignore-pattern '**/.vite-cache/**' && pnpm exec prettier -c ${lintFilters.join(" ")}`
    : "pnpm -s lint";
  process.stderr.write(`[verify] lint preflight: timeout -k 10s ${secs}s ${lintCmd}\n`);

  const eslintRes = scoped
    ? await $({
        stdio: "inherit",
        cwd: root,
        reject: false,
      })`timeout -k 10s ${secs}s pnpm exec eslint ${lintFilters} --ext .ts --max-warnings=0 --ignore-pattern buck-out --ignore-pattern coverage --ignore-pattern .clinic --ignore-pattern "**/.vite-cache/**"`
    : await $({
        stdio: "inherit",
        cwd: root,
        reject: false,
      })`timeout -k 10s ${secs}s pnpm -s lint`;
  if (eslintRes.exitCode !== 0) {
    process.stderr.write(
      "error: lint preflight failed; refusing to run verify while formatting/lint is dirty\n" +
        "hint: run 'pnpm -s lint:fix' (or format the specific files), then re-run 'v'\n",
    );
    process.exit(2);
  }
  if (scoped) {
    const prettierRes = await $({
      stdio: "inherit",
      cwd: root,
      reject: false,
    })`timeout -k 10s ${secs}s pnpm exec prettier -c ${lintFilters}`;
    if (prettierRes.exitCode !== 0) {
      process.stderr.write(
        "error: lint preflight failed; refusing to run verify while formatting/lint is dirty\n" +
          "hint: run 'pnpm -s lint:fix' (or format the specific files), then re-run 'v'\n",
      );
      process.exit(2);
    }
  }

  if (includeBuildSystemPolicy) {
    await runVerifyFileSizePreflight(root, zxInitPath);
    await runVerifySsrTestFileSizePreflight(root, zxInitPath);
    await runVerifyNixGapsPolicyPreflight(root, zxInitPath);
  } else {
    process.stderr.write(
      "[verify] file-size preflight: skipped build-system file-size gates for projects-only verify scope\n",
    );
    process.stderr.write(
      "[verify] nix-gaps policy preflight: skipped for projects-only verify scope\n",
    );
  }
}
