#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-node is byte-for-byte stable with synthetic lockfile", async () => {
  await runInTemp("node-determinism", async (tmp, $) => {
    // Initialize git so git ls-files works
    await $`git init`;

    const lockfilePath = path.join(tmp, "apps/example/pnpm-lock.yaml");
    const lockfileContent = `
lockfileVersion: "9.0"

importers:
  apps/example:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

packages:
  /lodash@4.17.21:
    resolution: { integrity: sha512-v2kDEe57D2ZWi2unGLLb0b... }
    engines: { node: ">=4" }
`.trim();

    await fsp.mkdir(path.dirname(lockfilePath), { recursive: true });
    await fsp.writeFile(lockfilePath, lockfileContent, "utf8");
    await $`git add apps/example/pnpm-lock.yaml`;

    // First run
    await $`node tools/buck/sync-providers.ts --lang node --no-glue`;
    const outPath = path.join(tmp, "third_party/providers/TARGETS.node.auto");
    const output1 = await fsp.readFile(outPath, "utf8");
    const hash1 = crypto.createHash("sha256").update(output1).digest("hex");

    // Second run
    await $`node tools/buck/sync-providers.ts --lang node --no-glue`;
    const output2 = await fsp.readFile(outPath, "utf8");
    const hash2 = crypto.createHash("sha256").update(output2).digest("hex");

    // Byte-for-byte identical
    if (hash1 !== hash2) {
      console.error("Output changed between runs");
      console.error("Hash 1:", hash1);
      console.error("Hash 2:", hash2);
      process.exit(2);
    }

    if (output1 !== output2) {
      console.error("Outputs differ despite matching hashes");
      process.exit(2);
    }

    // Verify provider rule was created (not just the load statement)
    const providerRules = output1
      .split("\n")
      .filter((l) => l.trim().startsWith("node_importer_deps("));
    if (providerRules.length === 0) {
      console.error("Expected at least one node_importer_deps rule in output");
      console.error("Output was:");
      console.error(output1);
      process.exit(2);
    }

    if (!output1.includes("apps/example/pnpm-lock.yaml")) {
      console.error("Expected lockfile path in output");
      process.exit(2);
    }
  });
});
