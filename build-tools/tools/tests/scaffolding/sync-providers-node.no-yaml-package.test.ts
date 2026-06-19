#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerAutoTargetsPath } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-node graceful skip when yaml package unavailable", async () => {
  await runInTemp("node-no-yaml", async (tmp, $) => {
    // Initialize git so git ls-files works
    await $`git init`;

    // Create a lockfile
    const lockfilePath = path.join(tmp, "apps/example/pnpm-lock.yaml");
    const lockfileContent = `
lockfileVersion: "9.0"

importers:
  apps/example:
    dependencies:
      lodash: 4.17.21

packages:
  /lodash@4.17.21:
    resolution: { integrity: sha512-... }
`.trim();

    await fsp.mkdir(path.dirname(lockfilePath), { recursive: true });
    await fsp.writeFile(lockfilePath, lockfileContent, "utf8");
    await $`git add apps/example/pnpm-lock.yaml`;

    // Temporarily hide node_modules/yaml by renaming package.json
    // This simulates yaml package being unavailable
    const yamlPkgPath = path.join(tmp, "node_modules/yaml/package.json");
    const yamlPkgBackup = path.join(tmp, "node_modules/yaml/package.json.bak");

    let yamlExists = false;
    try {
      await fsp.access(yamlPkgPath);
      yamlExists = true;
      await fsp.rename(yamlPkgPath, yamlPkgBackup);
    } catch {
      // yaml may not be in temp node_modules; skip this part
    }

    try {
      // Run sync - should write empty header and exit gracefully
      const result = await $({
        nothrow: true,
      })`node viberoots/build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;

      if (result.exitCode !== 0 && yamlExists) {
        console.error("Expected exit code 0 when yaml unavailable, got:", result.exitCode);
        process.exit(2);
      }

      const outPath = path.join(tmp, providerAutoTargetsPath("node"));
      const output = await fsp.readFile(outPath, "utf8");

      // Should have header but no actual providers (or just pass through if yaml was available)
      if (!output.includes("GENERATED FILE")) {
        console.error("Expected GENERATED FILE header in output");
        process.exit(2);
      }

      if (!output.includes("node_importer_deps")) {
        console.error("Expected load statement for node_importer_deps");
        process.exit(2);
      }

      // Should NOT crash or throw errors
    } finally {
      // Restore yaml package.json if we backed it up
      if (yamlExists) {
        try {
          await fsp.rename(yamlPkgBackup, yamlPkgPath);
        } catch {}
      }
    }
  });
});
