#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;
// Increase internal Node test timeout to handle slow cold-cache Nix builds in CI
test("webapp: scaffold, glue, build dist via Buck", { timeout: TEST_TIMEOUT_MS }, async () => {
  const prevRoots = process.env.TEST_RSYNC_ROOTS;
  if (!prevRoots) {
    process.env.TEST_RSYNC_ROOTS = "build-tools toolchains third_party/providers prelude patches";
  }
  try {
    await runInTemp("node-webapp-scaffold-build", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new node webapp demo-web --yes`;
      // Install deps via repo installer (handles pnpm store path and Nix node_modules)
      await $({
        cwd: path.join(tmp, "projects", "apps", "demo-web"),
        env: { ...process.env },
      })`zx-wrapper ../../../build-tools/tools/dev/install/deps-main.ts --verbose --glue-only`;
      // runInTemp commits the initial seed; stage generated importer + glue outputs so git-flake evaluation sees them.
      await $({
        cwd: tmp,
        stdio: "pipe",
      })`git add -A projects/apps/demo-web build-tools/tools/nix/node-modules.hashes.json build-tools/tools/nix/langs.nix build-tools/lang/importer_roots.bzl build-tools/tools/buck third_party/providers`;
      // No longer modify flake envs for LOCAL_PNPM_STORE; pure Nix path only
      // Build via Nix directly to avoid nested buck invocations from within a buck test
      const importer = "projects/apps/demo-web";
      // Prefetch removed: rely on pure Nix fetch inside FOD
      const appAbs = path.join(tmp, "projects", "apps", "demo-web");
      // Ensure no pre-existing node_modules links before pnpm ops (do not create writable dirs)
      try {
        await fsp.rm(path.join(tmp, "node_modules"), { recursive: true, force: true });
      } catch {}
      try {
        await fsp.rm(path.join(appAbs, "node_modules"), { recursive: true, force: true });
      } catch {}
      const lockfile = path.join(importer, "pnpm-lock.yaml");
      // No pnpm prefetch; Nix FOD handles it hermetically
      const sanitized = importer
        .replace(/\/\//g, "")
        .replace(/:/g, "-")
        .replace(/[\/\s]+/g, "-");
      const envWithPrefetch = { ...process.env, NIX_PNPM_ALLOW_GENERATE: "1" } as Record<
        string,
        string
      >;
      await $({
        cwd: tmp,
        stdio: "inherit",
        env: { ...envWithPrefetch },
      })`zx-wrapper build-tools/tools/dev/update-pnpm-hash.ts --lockfile ${lockfile}`;
      const nixOut = await (async () => {
        const mj = String(process.env.NIX_MAX_JOBS || "0");
        const cr = String(process.env.NIX_CORES || "0");
        const cmd = [
          "set -euo pipefail;",
          "nix build",
          `"${tmp}#node-webapp.${sanitized}"`,
          '--impure --no-link --accept-flake-config --builders "" --print-build-logs',
          mj && mj !== "0" ? `--max-jobs ${mj}` : "",
          cr && cr !== "0" ? `--option cores ${cr}` : "",
          "--print-out-paths",
        ]
          .filter(Boolean)
          .join(" ");
        return await $({
          stdio: "pipe",
          cwd: tmp,
          env: envWithPrefetch,
        })`bash --noprofile --norc -c ${cmd}`;
      })();
      const outPath =
        String(nixOut.stdout || "")
          .trim()
          .split("\n")
          .pop() || "";
      const index = path.join(outPath, "dist", "index.html");
      if (!(await exists(index))) throw new Error("dist/index.html missing in Nix webapp output");
    });
  } finally {
    if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
    else process.env.TEST_RSYNC_ROOTS = prevRoots;
  }
});
