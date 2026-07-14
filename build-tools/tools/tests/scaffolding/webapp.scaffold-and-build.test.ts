#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers";
import { buildSelectedOutPath } from "../lib/test-helpers/selected-build";
import {
  DEFAULT_TEMP_REPO_GLUE_STAGE_PATHS,
  stageTempRepoPaths,
} from "../lib/test-helpers/git-stage";

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
      const appAbs = path.join(tmp, "projects", "apps", "demo-web");
      // Ensure no pre-existing node_modules links before pnpm ops (do not create writable dirs)
      try {
        await fsp.rm(path.join(tmp, "node_modules"), { recursive: true, force: true });
      } catch {}
      try {
        await fsp.rm(path.join(appAbs, "node_modules"), { recursive: true, force: true });
      } catch {}
      await reconcileTempDependencyInputs(tmp, $);
      // Keep the fixture on the production filtered-snapshot build path.
      const outPath = await buildSelectedOutPath({
        tmp,
        $: _$,
        target: "//projects/apps/demo-web:app",
      });
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
