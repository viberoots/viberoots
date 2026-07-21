#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

test("sync-providers with --lang node syncs only Node providers", async () => {
  await runInTemp("sync-lang-node", async (tmp, $) => {
    // Initialize git so git ls-files works
    await $`git init`;

    // Create a Node lockfile
    const lockfilePath = path.join(tmp, "apps/example/pnpm-lock.yaml");
    await fsp.mkdir(path.dirname(lockfilePath), { recursive: true });
    await fsp.writeFile(
      lockfilePath,
      `lockfileVersion: "9.0"\nimporters:\n  apps/example:\n    dependencies: {}\npackages: {}`,
      "utf8",
    );
    await $`git add apps/example/pnpm-lock.yaml`;

    // Run with --lang node
    await $`node viberoots/build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;

    // Node provider file should exist
    const nodeProviderPath = path.join(tmp, ".viberoots/workspace/providers/TARGETS.node.auto");
    if (!(await exists(nodeProviderPath))) {
      console.error("Expected TARGETS.node.auto to be created");
      process.exit(2);
    }

    const nodeContent = await fsp.readFile(nodeProviderPath, "utf8");
    if (!nodeContent.includes("node_importer_deps")) {
      console.error("Expected node_importer_deps in Node provider file");
      process.exit(2);
    }

    // Go and C++ provider files should NOT be created/modified by --lang node
    // (They may exist from prior runs, but their mtime shouldn't be recent)
    const goProviderPath = path.join(tmp, ".viberoots/workspace/providers/TARGETS.auto");
    const cppProviderPath = path.join(tmp, ".viberoots/workspace/providers/TARGETS.cpp.auto");

    // Get mtime of node file
    const nodeStat = await fsp.stat(nodeProviderPath);
    const nodeTime = nodeStat.mtimeMs;

    // If Go/C++ files exist, their mtime should be much older
    // (or we can just verify they weren't created in this run)
    // Since we're in a fresh temp repo, they shouldn't exist yet
    const goExists = await exists(goProviderPath);
    const cppExists = await exists(cppProviderPath);

    if (goExists || cppExists) {
      // If they exist, verify they're older than the Node file
      // This would indicate they weren't modified in this run
      if (goExists) {
        const goStat = await fsp.stat(goProviderPath);
        if (goStat.mtimeMs >= nodeTime - 1000) {
          // Within 1 second = probably created together
          console.error("Go provider file was modified during --lang node run");
          process.exit(2);
        }
      }
      if (cppExists) {
        const cppStat = await fsp.stat(cppProviderPath);
        if (cppStat.mtimeMs >= nodeTime - 1000) {
          console.error("C++ provider file was modified during --lang node run");
          process.exit(2);
        }
      }
    }
  });
});
