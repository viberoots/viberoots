#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-node creates provider with optional dependencies lockfile", async () => {
  await runInTemp("node-optional", async (tmp, $) => {
    // Initialize git so git ls-files works
    await $`git init`;

    // Create lockfile with optional dependencies
    // This verifies the provider sync can parse lockfiles with optional deps
    const lockfilePath = path.join(tmp, "apps/example/pnpm-lock.yaml");
    const lockfileContent = `
lockfileVersion: "9.0"

importers:
  apps/example:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21
    optionalDependencies:
      fsevents:
        specifier: ^2.3.0
        version: 2.3.0

packages:
  /lodash/4.17.21:
    resolution: { integrity: sha512-... }

  /fsevents/2.3.0:
    resolution: { integrity: sha512-... }
    optional: true
`.trim();

    await fsp.mkdir(path.dirname(lockfilePath), { recursive: true });
    await fsp.writeFile(lockfilePath, lockfileContent, "utf8");
    await $`git add apps/example/pnpm-lock.yaml`;

    // Run sync (without patches to simplify test)
    await $`node tools/buck/sync-providers.ts --lang node --no-glue`;

    const outPath = path.join(tmp, "third_party/providers/TARGETS.node.auto");
    const output = await fsp.readFile(outPath, "utf8");

    // Verify provider was created
    if (!output.includes("node_importer_deps")) {
      console.error("Expected node_importer_deps rule");
      process.exit(2);
    }

    // Verify lockfile and importer are referenced
    if (!output.includes("apps/example/pnpm-lock.yaml")) {
      console.error("Expected lockfile path in output");
      process.exit(2);
    }

    if (!output.includes('importer="apps/example"')) {
      console.error("Expected importer in output");
      process.exit(2);
    }

    // Test passes if provider was created without errors
  });
});
