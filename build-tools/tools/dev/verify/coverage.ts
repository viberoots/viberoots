import "zx/globals";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buildToolPath } from "../dev-build/paths";

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function setupCoverage(opts: {
  root: string;
  enabled: boolean;
}): Promise<{ rawDir: string | null }> {
  if (!opts.enabled) {
    process.env.COVERAGE = "0";
    delete process.env.NODE_V8_COVERAGE;

    // Best-effort cleanup of stale raw coverage dirs (local runs only; avoid cross-run interference in CI).
    if (process.env.CI !== "true") {
      const parent = path.join(opts.root, "buck-out", "tmp", "node-v8-coverage");
      if (await pathExists(parent)) {
        await fsp
          .readdir(parent)
          .then(async (ents) => {
            for (const e of ents) {
              if (!e.startsWith("v-")) continue;
              await fsp.rm(path.join(parent, e), { recursive: true, force: true }).catch(() => {});
            }
          })
          .catch(() => {});
      }
    }

    return { rawDir: null };
  }

  process.env.COVERAGE = "1";
  const parent = path.join(opts.root, "buck-out", "tmp", "node-v8-coverage");
  await fsp.mkdir(parent, { recursive: true }).catch(() => {});
  const rawDir = await fsp.mkdtemp(path.join(parent, "v-"));
  process.env.NODE_V8_COVERAGE = rawDir;

  // Ensure merged report directory is clean and exists.
  const covDir = path.join(opts.root, "coverage");
  if (await pathExists(covDir)) {
    await $({
      stdio: "ignore",
      cwd: opts.root,
    })`bash --noprofile --norc -c 'set -euo pipefail; chmod -R u+w coverage >/dev/null 2>&1 || true; find coverage -mindepth 1 -maxdepth 1 -print0 2>/dev/null | xargs -0 rm -rf >/dev/null 2>&1 || true; rmdir coverage >/dev/null 2>&1 || true'`.nothrow();
  }
  await fsp.mkdir(covDir, { recursive: true }).catch(() => {});

  return { rawDir };
}

export async function runMergedCoverageReport(opts: {
  root: string;
  rawDir: string;
}): Promise<void> {
  const c8Js = path.join(opts.root, "node_modules", "c8", "bin", "c8.js");
  if (!(await pathExists(c8Js))) {
    process.stderr.write(`error: coverage enabled but c8 is missing at ${c8Js}\n`);
    process.stderr.write("hint: run 'i' to ensure node_modules are linked.\n");
    process.exit(2);
    return;
  }

  const nodeBin = process.env.NODE_BIN || "node";

  await $({
    stdio: "ignore",
    cwd: opts.root,
  })`${nodeBin} ${buildToolPath(opts.root, "tools/dev/coverage-raw-normalize.mjs")}`.nothrow();

  await $({
    stdio: "inherit",
    cwd: opts.root,
    env: { ...process.env, NODE_V8_COVERAGE: opts.rawDir },
  })`${nodeBin} ${c8Js} report --clean=false --temp-directory ${opts.rawDir} --reports-dir ${path.join(
    opts.root,
    "coverage",
  )} --reporter=json-summary --reporter=lcov --reporter=html --merge-async --extension .ts --allowExternal --src ${opts.root} --include **/*.ts --exclude node_modules/** --exclude buck-out/** --exclude .clinic/** --exclude **/*.d.ts`;

  await $({
    stdio: "ignore",
    cwd: opts.root,
  })`${nodeBin} ${buildToolPath(opts.root, "tools/dev/coverage-normalize.mjs")}`.nothrow();
}
