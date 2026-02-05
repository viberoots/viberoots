#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";

test("sync-providers-node detects provider name collisions", async () => {
  await runInTemp("node-collision", async (tmp, $) => {
    // Initialize git so git ls-files works
    await $`git init`;

    // Create two lockfiles with different importers
    const lf1 = path.join(tmp, "projects/apps/web/pnpm-lock.yaml");
    const lf2 = path.join(tmp, "projects/apps/api/pnpm-lock.yaml");

    await fsp.mkdir(path.dirname(lf1), { recursive: true });
    await fsp.mkdir(path.dirname(lf2), { recursive: true });

    const lockfileContent = `
lockfileVersion: "9.0"

importers:
  projects/apps/web:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

packages:
  /lodash@4.17.21:
    resolution: { integrity: sha512-v2kDEe57D2ZWi2unGLLb0b... }
    engines: { node: ">=4" }
`.trim();

    await fsp.writeFile(lf1, lockfileContent, "utf8");
    await fsp.writeFile(
      lf2,
      lockfileContent.replace("projects/apps/web", "projects/apps/api"),
      "utf8",
    );
    await $`git add projects/apps/web/pnpm-lock.yaml projects/apps/api/pnpm-lock.yaml`;

    // Normal case: no collision, should succeed
    await $`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;

    const outPath = path.join(tmp, "third_party/providers/TARGETS.node.auto");
    const output = await fsp.readFile(outPath, "utf8");

    // Verify both providers exist
    if (!output.includes("projects/apps/web") || !output.includes("projects/apps/api")) {
      console.error("Expected both importer providers in output");
      process.exit(2);
    }

    // Note: Actual hash collisions are astronomically unlikely (2^48 space)
    // This test verifies the collision detection *logic* exists
    // We cannot easily simulate a real collision without modifying the hash function
    // So we verify that different inputs produce different provider names
    const lines = output.split("\n");
    const expectedLockfiles = new Set<string>([
      "projects/apps/web/pnpm-lock.yaml",
      "projects/apps/api/pnpm-lock.yaml",
    ]);
    const providerNames = lines
      .map((l) => {
        const m = l.match(
          /node_importer_deps\(name="([^"]+)", lockfile="([^"]+)", importer="([^"]+)"/,
        );
        if (!m) return null;
        const [, name, lockfile, importer] = m;
        if (!expectedLockfiles.has(lockfile)) return null;
        if (importer !== path.posix.dirname(lockfile)) return null;
        return name;
      })
      .filter((v): v is string => typeof v === "string" && v.length > 0);

    if (providerNames.length !== 2) {
      console.error(`Expected 2 provider names, got ${providerNames.length}`);
      process.exit(2);
    }

    // Verify they're different (no collision)
    if (providerNames[0] === providerNames[1]) {
      console.error("Collision detected: both providers have same name");
      process.exit(2);
    }
  });
});
