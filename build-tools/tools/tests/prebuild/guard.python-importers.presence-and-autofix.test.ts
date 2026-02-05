#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

test("prebuild-guard: flags missing Python importer providers and auto-fixes locally", async () => {
  await runInTemp("prebuild-python-importers", async (tmp, $) => {
    const providersDir = path.join(tmp, "third_party", "providers");
    await fsp.mkdir(providersDir, { recursive: true });
    // Minimal glue outputs (graph + auto_map) present
    await fsp.writeFile(
      path.join(tmp, "build-tools", "tools", "buck", "graph.json"),
      "[]\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "build-tools", "tools", "buck", "node-lock-index.json"),
      "{}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "build-tools", "tools", "buck", "invalidation-report.txt"),
      "# invalidation-report\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(providersDir, "auto_map.bzl"),
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
    const targetsPy = path.join(providersDir, "TARGETS.python.auto");
    await fsp.writeFile(targetsPy, "# GENERATED FILE — DO NOT EDIT.\n\n", "utf8");

    // Initialize git so presence scan discovers uv.lock via git ls-files
    await $({ cwd: tmp })`git init`;
    await $({ cwd: tmp })`git add ${path.relative(tmp, uvLockPath)}`;

    // Run guard in no-fix mode first (should not error locally)
    const env = { ...process.env, PREBUILD_GUARD_NO_FIX: "1" };
    await $({
      cwd: tmp,
      env,
    })`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/buck/prebuild-guard.ts`;

    // Now allow auto-fix and re-run; guard should regenerate Python providers
    await $({
      cwd: tmp,
    })`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/buck/prebuild-guard.ts`;
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
    })`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/buck/prebuild-guard.ts`;
    if (!(await exists(targetsPy))) throw new Error("TARGETS.python.auto missing after auto-fix");
  });
});
