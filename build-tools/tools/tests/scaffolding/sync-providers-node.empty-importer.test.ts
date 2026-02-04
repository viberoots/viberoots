#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-node handles empty importer gracefully", async () => {
  await runInTemp("node-empty-imp", async (tmp, $) => {
    // Initialize git so git ls-files works
    await $`git init`;

    const lockfilePath = path.join(tmp, "apps/empty/pnpm-lock.yaml");
    const lockfileContent = `
lockfileVersion: "9.0"

importers:
  apps/empty:
    dependencies: {}

packages: {}
`.trim();

    await fsp.mkdir(path.dirname(lockfilePath), { recursive: true });
    await fsp.writeFile(lockfilePath, lockfileContent, "utf8");
    await $`git add apps/empty/pnpm-lock.yaml`;

    // Run sync
    await $`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;

    const outPath = path.join(tmp, "third_party/providers/TARGETS.node.auto");
    const output = await fsp.readFile(outPath, "utf8");

    // Verify provider was created even for empty importer
    if (!output.includes("node_importer_deps")) {
      console.error("Expected node_importer_deps rule for empty importer");
      process.exit(2);
    }

    if (!output.includes("apps/empty")) {
      console.error("Expected apps/empty importer in output");
      process.exit(2);
    }

    // Verify empty patch list (patch_paths=[])
    if (!output.includes("patch_paths=[]")) {
      console.error("Expected empty patch_paths for empty importer");
      process.exit(2);
    }

    // Verify idempotency
    await $`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;
    const output2 = await fsp.readFile(outPath, "utf8");

    if (output !== output2) {
      console.error("Output changed on second run with empty importer");
      process.exit(2);
    }
  });
});
