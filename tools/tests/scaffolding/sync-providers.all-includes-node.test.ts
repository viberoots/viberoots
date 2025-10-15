#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

test("sync-providers without lang flag includes Node providers", async () => {
  await runInTemp("sync-all-node", async (tmp, $) => {
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

    // Run without --lang flag (sync all)
    await $`node tools/buck/sync-providers.ts`;

    // All provider files should be created
    const nodeProviderPath = path.join(tmp, "third_party/providers/TARGETS.node.auto");
    const goProviderPath = path.join(tmp, "third_party/providers/TARGETS.auto");
    const cppProviderPath = path.join(tmp, "third_party/providers/TARGETS.cpp.auto");

    // Node provider must exist
    if (!(await exists(nodeProviderPath))) {
      console.error("Expected TARGETS.node.auto to be created in all-languages sync");
      process.exit(2);
    }

    const nodeContent = await fsp.readFile(nodeProviderPath, "utf8");
    if (!nodeContent.includes("node_importer_deps")) {
      console.error("Expected node_importer_deps in Node provider file");
      process.exit(2);
    }

    // Go provider should exist (even if empty)
    if (!(await exists(goProviderPath))) {
      console.error("Expected TARGETS.auto (Go) to be created in all-languages sync");
      process.exit(2);
    }

    // C++ provider should exist (even if empty)
    if (!(await exists(cppProviderPath))) {
      console.error("Expected TARGETS.cpp.auto to be created in all-languages sync");
      process.exit(2);
    }

    // Verify Node provider has content
    if (nodeContent.includes("apps/example")) {
      // Good - has actual provider
    } else {
      console.error("Expected Node provider to include apps/example importer");
      process.exit(2);
    }

    // No errors when Node has lockfiles
    // (Verifies graceful handling when some languages have deps and others don't)
  });
});
