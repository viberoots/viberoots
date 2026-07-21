#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_INVALIDATION_REPORT_PATH,
  DEFAULT_NODE_LOCK_INDEX_PATH,
  providerAutoTargetsPath,
} from "../../lib/workspace-state-paths";
import { exists, runInTemp } from "../lib/test-helpers";
import { reconcileSyntheticGeneratedGraph } from "../lib/generated-graph.fixture";

test("prebuild-guard: flags missing Python importer providers and auto-fixes locally", async () => {
  await runInTemp("prebuild-python-importers", async (tmp, $) => {
    const providersDir = path.dirname(path.join(tmp, DEFAULT_AUTO_MAP_PATH));
    await fsp.mkdir(providersDir, { recursive: true });
    await fsp.mkdir(path.dirname(path.join(tmp, DEFAULT_NODE_LOCK_INDEX_PATH)), {
      recursive: true,
    });
    // Minimal non-graph glue outputs are present; the graph fixture is reconciled below.
    await fsp.writeFile(path.join(tmp, DEFAULT_NODE_LOCK_INDEX_PATH), "{}\n", "utf8");
    await fsp.writeFile(
      path.join(tmp, DEFAULT_INVALIDATION_REPORT_PATH),
      "# invalidation-report\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, DEFAULT_AUTO_MAP_PATH),
      "# gen\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );

    // Create a uv.lock for a Python importer
    const importer = path.join(tmp, "projects", "apps", "pytool");
    await fsp.mkdir(importer, { recursive: true });
    const uvLockPath = path.join(importer, "uv.lock");
    const uvLock = ["# uv lock", "[[package]]", 'name = "requests"', 'version = "2.32.3"', ""].join(
      "\n",
    );
    await fsp.writeFile(uvLockPath, uvLock, "utf8");

    // Ensure TARGETS.python.auto is either missing or empty
    const targetsPy = path.join(tmp, providerAutoTargetsPath("python"));
    await fsp.writeFile(targetsPy, "# GENERATED FILE — DO NOT EDIT.\n\n", "utf8");

    // Initialize git so presence scan discovers uv.lock via git ls-files
    await $({ cwd: tmp })`git init`;
    await $({ cwd: tmp })`git add ${path.relative(tmp, uvLockPath)}`;
    const graphEnv = await reconcileSyntheticGeneratedGraph(tmp);

    // Run guard in no-fix mode first (should not error locally)
    const env = { ...graphEnv, PREBUILD_GUARD_NO_FIX: "1" };
    await $({
      cwd: tmp,
      env: graphEnv,
      env,
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/buck/prebuild-guard.ts`;

    // Now allow auto-fix and re-run; guard should regenerate Python providers
    await $({
      cwd: tmp,
      env: graphEnv,
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/buck/prebuild-guard.ts`;
    const txt = await fsp.readFile(targetsPy, "utf8");
    if (
      !txt.includes("python_importer_deps(") ||
      !txt.includes('lockfile="projects/apps/pytool/uv.lock"') ||
      !txt.includes('importer="projects/apps/pytool"')
    ) {
      throw new Error("expected TARGETS.python.auto to include python_importer_deps for importer");
    }

    // Touch uv.lock to make it newer than outputs; guard should detect and auto-fix
    await new Promise((r) => setTimeout(r, 10));
    await fsp.appendFile(uvLockPath, "# touch\n", "utf8");
    await $({
      cwd: tmp,
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/buck/prebuild-guard.ts`;
    if (!(await exists(targetsPy))) throw new Error("TARGETS.python.auto missing after auto-fix");
  });
});
