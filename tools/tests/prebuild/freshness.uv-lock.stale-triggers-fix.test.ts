#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

test("prebuild-guard: touching uv.lock marks stale and auto-fixes locally", async () => {
  await runInTemp("prebuild-uv-freshness", async (tmp, $) => {
    const providersDir = path.join(tmp, "third_party", "providers");
    await fsp.mkdir(providersDir, { recursive: true });
    // Minimal glue outputs (graph + auto_map) present
    await fsp.writeFile(path.join(tmp, "tools", "buck", "graph.json"), "[]\n", "utf8");
    await fsp.writeFile(path.join(tmp, "tools", "buck", "node-lock-index.json"), "{}\n", "utf8");
    await fsp.writeFile(
      path.join(tmp, "tools", "buck", "invalidation-report.txt"),
      "# invalidation-report\n",
      "utf8",
    );
    const targetsPy = path.join(providersDir, "TARGETS.python.auto");
    await fsp.writeFile(
      path.join(providersDir, "auto_map.bzl"),
      "# gen\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );
    // Create a uv.lock for a Python importer
    const importerDir = path.join(tmp, "apps", "pytool");
    await fsp.mkdir(importerDir, { recursive: true });
    const uvLockPath = path.join(importerDir, "uv.lock");
    const uvLock = ["# uv lock", "[[package]]", 'name = "requests"', 'version = "2.32.3"', ""].join(
      "\n",
    );
    await fsp.writeFile(uvLockPath, uvLock, "utf8");

    // Initialize git so inputs discovery uses git ls-files
    await $({ cwd: tmp })`git init`;
    await $({ cwd: tmp })`git add ${path.relative(tmp, uvLockPath)}`;

    // First run: allow auto-fix to generate python providers from uv.lock
    await $({
      cwd: tmp,
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/prebuild-guard.ts`;
    if (!(await exists(targetsPy))) {
      throw new Error("expected TARGETS.python.auto to exist after initial auto-fix");
    }

    // Touch uv.lock to be newer than outputs; guard should detect staleness and auto-fix
    await new Promise((r) => setTimeout(r, 10));
    await fsp.appendFile(uvLockPath, "# touch\n", "utf8");
    await $({
      cwd: tmp,
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/prebuild-guard.ts`;

    // After auto-fix, providers should still be present
    if (!(await exists(targetsPy))) throw new Error("TARGETS.python.auto missing after auto-fix");
  });
});
