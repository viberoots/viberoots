#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp, workspaceFlakeRef } from "../lib/test-helpers";
import {
  DEFAULT_TEMP_REPO_GLUE_STAGE_PATHS,
  stageTempRepoPaths,
} from "../lib/test-helpers/git-stage";
import { resolveFinalPnpmStore } from "../../dev/update-pnpm-hash/realized-store";
import { viberootsDevTool } from "./lib/viberoots-tools";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;
// Increase internal Node test timeout to handle slow cold-cache Nix builds in CI
test("webapp: scaffold, glue, build dist via Buck", { timeout: TEST_TIMEOUT_MS }, async () => {
  const prevRoots = process.env.TEST_RSYNC_ROOTS;
  if (!prevRoots) {
    process.env.TEST_RSYNC_ROOTS =
      "viberoots/build-tools toolchains third_party/providers prelude patches";
  }
  try {
    await runInTemp("node-webapp-scaffold-build", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --skip-lockfile-gen`;
      // Install deps via repo installer (handles pnpm store path and Nix node_modules)
      await $({
        cwd: path.join(tmp, "projects", "apps", "demo-web"),
        env: { ...process.env },
      })`zx-wrapper ../../../viberoots/build-tools/tools/dev/install/deps-main.ts --verbose --glue-only`;
      // Stage scaffold outputs and the exact glue files used by flake evaluation, while
      // avoiding node_modules and other large transient trees under the importer.
      await stageTempRepoPaths({
        tmp,
        _$,
        recursiveRoots: ["projects/apps/demo-web"],
        explicitPaths: [...DEFAULT_TEMP_REPO_GLUE_STAGE_PATHS],
      });
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
      })`zx-wrapper ${viberootsDevTool("update-pnpm-hash.ts")} --lockfile ${lockfile}`;
      const flakeRef = await workspaceFlakeRef(tmp);
      const fixedStore = await resolveFinalPnpmStore({
        repoRoot: tmp,
        importer,
        flakeRef: `path:${flakeRef}`,
        attrPath: `pnpm-store.${sanitized}`,
      });
      const nixOut = await (async () => {
        try {
          const mj = String(process.env.NIX_MAX_JOBS || "0");
          const cr = String(process.env.NIX_CORES || "0");
          const cmd = [
            "set -euo pipefail;",
            "nix build",
            `"path:${flakeRef}#node-webapp.${sanitized}"`,
            '--no-link --accept-flake-config --builders "" --print-build-logs',
            mj && mj !== "0" ? `--max-jobs ${mj}` : "",
            cr && cr !== "0" ? `--option cores ${cr}` : "",
            "--print-out-paths",
          ]
            .filter(Boolean)
            .join(" ");
          return await $({
            stdio: "pipe",
            cwd: tmp,
            env: process.env,
          })`bash --noprofile --norc -c ${cmd}`;
        } finally {
          await fixedStore.cleanup();
        }
      })();
      const outPath =
        String(nixOut.stdout || "")
          .trim()
          .split("\n")
          .pop() || "";
      const index = path.join(outPath, "dist", "index.html");
      if (!(await exists(index))) throw new Error("dist/index.html missing in Nix webapp output");
      const stagedWasm = path.join(outPath, "dist", "top.wasm");
      if (!(await exists(stagedWasm)))
        throw new Error("dist/top.wasm missing in Nix webapp output");
      const serverParityWasm = path.join(outPath, "dist", "server", "wasm", "top.wasm");
      if (!(await exists(serverParityWasm))) {
        throw new Error("dist/server/wasm/top.wasm missing in Nix webapp output");
      }
      const inlineModule = path.join(outPath, "dist", "wasm-inline", "index.js");
      if (!(await exists(inlineModule))) {
        throw new Error("dist/wasm-inline/index.js missing in Nix webapp output");
      }
      const entrySource = await fsp.readFile(path.join(appAbs, "src", "wasm-contract.ts"), "utf8");
      assert.match(entrySource, /entry\.sourcePath/);
      assert.doesNotMatch(entrySource, /wasm-inline/);
    });
  } finally {
    if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
    else process.env.TEST_RSYNC_ROOTS = prevRoots;
  }
});
