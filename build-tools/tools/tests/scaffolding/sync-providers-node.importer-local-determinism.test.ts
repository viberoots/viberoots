#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-node remains byte-stable with importer-local patches present", async () => {
  await runInTemp("node-importer-local-determinism", async (tmp, $) => {
    await $`git init`;

    const importerDir = path.join(tmp, "apps/site");
    const lockfilePath = path.join(importerDir, "pnpm-lock.yaml");
    const lockfileContent = `
lockfileVersion: "9.0"

importers:
  apps/site:
    dependencies:
      left-pad:
        specifier: ^1.3.0
        version: 1.3.0

packages:
  /left-pad@1.3.0:
    resolution: { integrity: sha512-xyz... }
`.trim();

    // Create importer-local patches (order shouldn't affect output)
    const localPatchDir = path.join(importerDir, "patches/node");
    await fsp.mkdir(localPatchDir, { recursive: true });
    await fsp.writeFile(path.join(localPatchDir, "b@2.0.0.patch"), "# test\n", "utf8");
    await fsp.writeFile(path.join(localPatchDir, "a@1.0.0.patch"), "# test\n", "utf8");

    await fsp.mkdir(path.dirname(lockfilePath), { recursive: true });
    await fsp.writeFile(lockfilePath, lockfileContent, "utf8");
    await $`git add apps/site/pnpm-lock.yaml`;

    // First run
    await $`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;
    const outPath = path.join(tmp, "third_party/providers/TARGETS.node.auto");
    const output1 = await fsp.readFile(outPath, "utf8");
    const hash1 = crypto.createHash("sha256").update(output1).digest("hex");

    // Second run
    await $`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;
    const output2 = await fsp.readFile(outPath, "utf8");
    const hash2 = crypto.createHash("sha256").update(output2).digest("hex");

    if (hash1 !== hash2 || output1 !== output2) {
      console.error("Output changed between runs with importer-local patches present");
      console.error("Hash 1:", hash1);
      console.error("Hash 2:", hash2);
      process.exit(2);
    }
  });
});
