#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-node lists importer-local patches in patch_paths (sorted, deterministic)", async () => {
  await runInTemp("node-importer-local-visibility", async (tmp, $) => {
    await $`git init`;

    const importerDir = path.join(tmp, "apps/web");
    const lockfilePath = path.join(importerDir, "pnpm-lock.yaml");
    const lockfileContent = `
lockfileVersion: "9.0"

importers:
  apps/web:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

packages:
  /lodash@4.17.21:
    resolution: { integrity: sha512-abc... }
`.trim();

    // Create importer-local patches
    const localPatchDir = path.join(importerDir, "patches/node");
    await fsp.mkdir(localPatchDir, { recursive: true });
    // Out-of-order filenames to verify sorting in output
    await fsp.writeFile(path.join(localPatchDir, "zzz@9.9.9.patch"), "# test\n", "utf8");
    await fsp.writeFile(path.join(localPatchDir, "aaa@1.0.0.patch"), "# test\n", "utf8");

    await fsp.mkdir(path.dirname(lockfilePath), { recursive: true });
    await fsp.writeFile(lockfilePath, lockfileContent, "utf8");
    await $`git add apps/web/pnpm-lock.yaml`;

    await $`node tools/buck/sync-providers.ts --lang node --no-glue`;
    const outPath = path.join(tmp, "third_party/providers/TARGETS.node.auto");
    const output = await fsp.readFile(outPath, "utf8");

    // Expect the provider entry to include importer-local patch paths (sorted)
    const expectedA = "apps/web/patches/node/aaa@1.0.0.patch";
    const expectedZ = "apps/web/patches/node/zzz@9.9.9.patch";

    if (!output.includes("node_importer_deps(")) {
      console.error("Missing node_importer_deps rule in output");
      console.error(output);
      process.exit(2);
    }
    if (!output.includes(expectedA) || !output.includes(expectedZ)) {
      console.error("Expected importer-local patch_paths not found in output");
      console.error("Output:");
      console.error(output);
      process.exit(2);
    }
    // Ensure order is sorted (aaa before zzz)
    const idxA = output.indexOf(expectedA);
    const idxZ = output.indexOf(expectedZ);
    if (!(idxA >= 0 && idxZ > idxA)) {
      console.error("Expected importer-local patch_paths to be sorted");
      process.exit(2);
    }
  });
});
