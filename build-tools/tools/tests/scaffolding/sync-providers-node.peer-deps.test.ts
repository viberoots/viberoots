#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerAutoTargetsPath } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-node creates provider with peer dependency lockfile", async () => {
  await runInTemp("node-peers", async (tmp, $) => {
    // Initialize git so git ls-files works
    await $`git init`;

    // Create lockfile with peer dependencies
    // This verifies the provider sync can parse lockfiles with peer dependencies
    // Full patch matching is covered with real project fixtures elsewhere.
    const lockfilePath = path.join(tmp, "projects/apps/example/pnpm-lock.yaml");
    const lockfileContent = `
lockfileVersion: "9.0"

importers:
  projects/apps/example:
    dependencies:
      react-dom:
        specifier: ^18.0.0
        version: 18.0.0

packages:
  /react-dom/18.0.0:
    resolution: { integrity: sha512-... }
    peerDependencies:
      react: ^18.0.0
    dependencies:
      react: 18.0.0

  /react/18.0.0:
    resolution: { integrity: sha512-... }
`.trim();

    await fsp.mkdir(path.dirname(lockfilePath), { recursive: true });
    await fsp.writeFile(lockfilePath, lockfileContent, "utf8");
    await $`git add projects/apps/example/pnpm-lock.yaml`;

    // Run sync (without patches to simplify test)
    await $`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;

    const outPath = path.join(tmp, providerAutoTargetsPath("node"));
    const output = await fsp.readFile(outPath, "utf8");

    // Verify provider was created
    if (!output.includes("node_importer_deps")) {
      console.error("Expected node_importer_deps rule");
      console.error("Output was:");
      console.error(output);
      process.exit(2);
    }

    // Verify lockfile and importer are referenced
    if (!output.includes("projects/apps/example/pnpm-lock.yaml")) {
      console.error("Expected lockfile path in output");
      process.exit(2);
    }

    if (!output.includes('importer="projects/apps/example"')) {
      console.error("Expected importer in output");
      process.exit(2);
    }

    // Verify no errors during parsing (test passes if we get here)
  });
});
