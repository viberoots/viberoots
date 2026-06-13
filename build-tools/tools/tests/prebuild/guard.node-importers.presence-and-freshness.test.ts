#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

test("prebuild-guard: flags missing Node importer providers and auto-fixes locally", async () => {
  await runInTemp("prebuild-node-importers", async (tmp, $) => {
    const providersDir = path.join(tmp, ".viberoots", "workspace", "providers");
    const buckDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fsp.mkdir(providersDir, { recursive: true });
    await fsp.mkdir(buckDir, { recursive: true });
    // Minimal glue outputs (graph + auto_map) present
    await fsp.writeFile(path.join(buckDir, "graph.json"), "[]\n", "utf8");
    await fsp.writeFile(path.join(buckDir, "node-lock-index.json"), "{}\n", "utf8");
    await fsp.writeFile(
      path.join(buckDir, "invalidation-report.txt"),
      "# invalidation-report\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(providersDir, "auto_map.bzl"),
      "# gen\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );
    // Create a pnpm-lock.yaml with one importer
    const lockDir = path.join(tmp, "projects", "apps", "example");
    await fsp.mkdir(lockDir, { recursive: true });
    const lockPath = path.join(lockDir, "pnpm-lock.yaml");
    const importerId = "projects/apps/example";
    const lockContent = [
      "lockfileVersion: '9.0'",
      "importers:",
      `  ${importerId}:`,
      "    dependencies: {}",
      "packages: {}",
      "",
    ].join("\n");
    await fsp.writeFile(lockPath, lockContent, "utf8");

    // Ensure TARGETS.node.auto is either missing or empty
    const targetsNode = path.join(providersDir, "TARGETS.node.auto");
    await fsp.writeFile(targetsNode, "# GENERATED FILE — DO NOT EDIT.\n\n", "utf8");

    // Initialize git so provider sync discovers lockfiles via git ls-files
    await $({ cwd: tmp })`git init`;
    await $({ cwd: tmp })`git add ${path.relative(tmp, lockPath)}`;

    // Run guard with no-fix mode to observe error-free local behavior and a skip note
    const env = { ...process.env, PREBUILD_GUARD_NO_FIX: "1" };
    await $({
      cwd: tmp,
      env,
    })`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/buck/prebuild-guard.ts`;

    // Now allow auto-fix and re-run; guard should regenerate providers via autoFixGlue
    await $({
      cwd: tmp,
    })`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/buck/prebuild-guard.ts`;
    const txt = await fsp.readFile(targetsNode, "utf8");
    if (
      !txt.includes("node_importer_deps(") ||
      !txt.includes(`lockfile="projects/apps/example/pnpm-lock.yaml"`)
    ) {
      throw new Error("expected TARGETS.node.auto to include node_importer_deps for importer");
    }

    // Touch lockfile to make it newer than outputs; guard should detect staleness then auto-fix
    await new Promise((r) => setTimeout(r, 10));
    await fsp.appendFile(lockPath, "# touch\n", "utf8");
    await $({
      cwd: tmp,
    })`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/buck/prebuild-guard.ts`;
    // After auto-fix, TARGETS.node.auto should still be present
    if (!(await exists(targetsNode))) throw new Error("TARGETS.node.auto missing after auto-fix");
  });
});
