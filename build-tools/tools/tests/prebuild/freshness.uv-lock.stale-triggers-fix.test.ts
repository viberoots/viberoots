#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_INVALIDATION_REPORT_PATH,
  DEFAULT_NODE_LOCK_INDEX_PATH,
  providerAutoTargetsPath,
  WORKSPACE_PROVIDER_DIR,
} from "../../lib/workspace-state-paths";
import { exists, runInTemp } from "../lib/test-helpers";
import { reconcileSyntheticGeneratedGraph } from "../lib/generated-graph.fixture";

test("prebuild-guard: touching uv.lock marks stale and auto-fixes locally", async () => {
  await runInTemp("prebuild-uv-freshness", async (tmp, $) => {
    const providersDir = path.join(tmp, WORKSPACE_PROVIDER_DIR);
    await fsp.mkdir(providersDir, { recursive: true });
    // Minimal non-graph glue outputs are present; the graph fixture is reconciled below.
    await fsp.writeFile(path.join(tmp, DEFAULT_NODE_LOCK_INDEX_PATH), "{}\n", "utf8");
    await fsp.writeFile(
      path.join(tmp, DEFAULT_INVALIDATION_REPORT_PATH),
      "# invalidation-report\n",
      "utf8",
    );
    const targetsPy = path.join(tmp, providerAutoTargetsPath("python"));
    await fsp.writeFile(
      path.join(tmp, DEFAULT_AUTO_MAP_PATH),
      "# gen\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );
    // Create a uv.lock for a Python importer
    const importerDir = path.join(tmp, "projects", "apps", "pytool");
    await fsp.mkdir(importerDir, { recursive: true });
    const uvLockPath = path.join(importerDir, "uv.lock");
    const uvLock = ["# uv lock", "[[package]]", 'name = "requests"', 'version = "2.32.3"', ""].join(
      "\n",
    );
    await fsp.writeFile(uvLockPath, uvLock, "utf8");

    // Initialize git so inputs discovery uses git ls-files
    await $({ cwd: tmp })`git init`;
    await $({ cwd: tmp })`git add ${path.relative(tmp, uvLockPath)}`;
    const graphEnv = await reconcileSyntheticGeneratedGraph(tmp);

    // First run: allow auto-fix to generate python providers from uv.lock
    await $({
      cwd: tmp,
      env: graphEnv,
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/buck/prebuild-guard.ts`;
    if (!(await exists(targetsPy))) {
      throw new Error("expected TARGETS.python.auto to exist after initial auto-fix");
    }

    // Touch uv.lock to be newer than outputs; guard should detect staleness and auto-fix
    await new Promise((r) => setTimeout(r, 10));
    await fsp.appendFile(uvLockPath, "# touch\n", "utf8");
    await $({
      cwd: tmp,
      env: graphEnv,
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/buck/prebuild-guard.ts`;

    // After auto-fix, providers should still be present
    if (!(await exists(targetsPy))) throw new Error("TARGETS.python.auto missing after auto-fix");
  });
});
