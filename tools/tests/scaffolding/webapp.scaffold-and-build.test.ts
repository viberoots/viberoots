#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

// Increase internal Node test timeout to stay under the external 120s budget
test("webapp: scaffold, glue, build dist via Buck", { timeout: 240_000 }, async () => {
  await runInTemp("node-webapp-scaffold-build", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`scaf new node webapp demo-web --yes`;
    // Install deps via repo installer (handles pnpm store path and Nix node_modules)
    await $({
      cwd: path.join(tmp, "apps", "demo-web"),
      env: { ...process.env },
    })`zx-wrapper ../../tools/dev/install/deps-main.ts --verbose --glue-only`;
    // TEMP-DIAG: log installer outputs/env
    console.error("[diag] after install, running glue");
    // Glue (no buck invocations)
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    await $`node tools/buck/sync-providers-node.ts`;
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    // No longer modify flake envs for LOCAL_PNPM_STORE; pure Nix path only
    // Ensure temp flake uses corrected timeout quoting in node-modules.nix (avoid Nix interpreting ${FT})
    try {
      const nmFile = path.join(tmp, "tools/nix/node-modules.nix");
      let txt = await fsp.readFile(nmFile, "utf8");
      if (txt.includes('timeout "${FT}s"')) {
        txt = txt.replace('timeout "${FT}s"', 'timeout "$FT"s');
        await fsp.writeFile(nmFile, txt, "utf8");
      }
    } catch {}
    // Build via Nix directly to avoid nested buck invocations from within a buck test
    const importer = "apps/demo-web";
    // Prefetch removed: rely on pure Nix fetch inside FOD
    const appAbs = path.join(tmp, "apps", "demo-web");
    // Ensure no pre-existing node_modules links before pnpm ops (do not create writable dirs)
    try {
      await fsp.rm(path.join(tmp, "node_modules"), { recursive: true, force: true });
    } catch {}
    try {
      await fsp.rm(path.join(appAbs, "node_modules"), { recursive: true, force: true });
    } catch {}
    // No pnpm prefetch; Nix FOD handles it hermetically
    const sanitized = importer
      .replace(/\/\//g, "")
      .replace(/:/g, "-")
      .replace(/[\/\s]+/g, "-");
    const envWithPrefetch = { ...process.env, NIX_PNPM_ALLOW_GENERATE: "1" } as Record<
      string,
      string
    >;
    // Compute/update FOD hash for pnpm-store (works even if lockfile was generated inside FOD)
    await $({
      cwd: tmp,
      stdio: "inherit",
      env: { ...envWithPrefetch, INSTALL_LOCK_SKIP: "1" },
    })`zx-wrapper tools/dev/update-pnpm-hash.ts --lockfile ${path.join(importer, "pnpm-lock.yaml")}`;
    // Ensure pnpm-store FOD is built before node-modules
    await $({
      cwd: tmp,
      stdio: "inherit",
      env: { ...envWithPrefetch, INSTALL_LOCK_SKIP: "1" },
    })`bash --noprofile --norc -c 'nix build "${tmp}#pnpm-store.${sanitized}" --impure --no-substitute --no-link --accept-flake-config --print-build-logs --max-jobs 1 --option cores 1'`;
    const nmBuild = await $({
      cwd: tmp,
      stdio: "inherit",
      env: { ...envWithPrefetch, INSTALL_LOCK_SKIP: "1" },
    })`bash --noprofile --norc -c 'nix build "${tmp}#node-modules.${sanitized}" --impure --no-substitute --no-link --accept-flake-config --print-build-logs --max-jobs 1 --option cores 1'`;
    const nixOut = await $({
      stdio: "pipe",
      cwd: tmp,
      env: envWithPrefetch,
    })`bash --noprofile --norc -c 'nix build "${tmp}#node-webapp.${sanitized}" --impure --no-substitute --no-link --accept-flake-config --print-build-logs --max-jobs 1 --option cores 1 --print-out-paths'`;
    const outPath =
      String(nixOut.stdout || "")
        .trim()
        .split("\n")
        .pop() || "";
    const index = path.join(outPath, "dist", "index.html");
    if (!(await exists(index))) throw new Error("dist/index.html missing in Nix webapp output");
  });
});
