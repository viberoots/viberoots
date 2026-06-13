#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerAutoTargetsPath } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-node deterministic ordering with multiple importers", async () => {
  await runInTemp("node-multi-imp", async (tmp, $) => {
    // Initialize git so git ls-files works
    await $`git init`;
    // Keep the fixture focused on per-importer lockfiles under apps/* and libs/*.
    // The workspace copy may include a repo-root pnpm-lock.yaml used for tooling; remove it.
    await fsp.rm(path.join(tmp, "pnpm-lock.yaml"), { force: true });

    // Create separate lockfiles for 3 different projects (per-importer design)
    const webLockfile = path.join(tmp, "projects/apps/web/pnpm-lock.yaml");
    const apiLockfile = path.join(tmp, "projects/apps/api/pnpm-lock.yaml");
    const utilsLockfile = path.join(tmp, "projects/libs/utils/pnpm-lock.yaml");

    await fsp.mkdir(path.dirname(webLockfile), { recursive: true });
    await fsp.mkdir(path.dirname(apiLockfile), { recursive: true });
    await fsp.mkdir(path.dirname(utilsLockfile), { recursive: true });

    // Each lockfile has its own importer
    await fsp.writeFile(
      webLockfile,
      `
lockfileVersion: "9.0"

importers:
  projects/apps/web:
    dependencies:
      react:
        specifier: ^18.0.0
        version: 18.0.0

packages:
  /react@18.0.0:
    resolution: { integrity: sha512-... }
`.trim(),
      "utf8",
    );

    await fsp.writeFile(
      apiLockfile,
      `
lockfileVersion: "9.0"

importers:
  projects/apps/api:
    dependencies:
      express:
        specifier: ^4.18.0
        version: 4.18.0

packages:
  /express@4.18.0:
    resolution: { integrity: sha512-... }
`.trim(),
      "utf8",
    );

    await fsp.writeFile(
      utilsLockfile,
      `
lockfileVersion: "9.0"

importers:
  projects/libs/utils:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

packages:
  /lodash@4.17.21:
    resolution: { integrity: sha512-... }
`.trim(),
      "utf8",
    );

    await $`git add projects/apps/web/pnpm-lock.yaml projects/apps/api/pnpm-lock.yaml projects/libs/utils/pnpm-lock.yaml`;

    // First run
    await $`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;
    const outPath = path.join(tmp, providerAutoTargetsPath("node"));
    const output1 = await fsp.readFile(outPath, "utf8");

    // Second run
    await $`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;
    const output2 = await fsp.readFile(outPath, "utf8");

    // Byte-for-byte identical
    if (output1 !== output2) {
      console.error("Output changed between runs with multiple importers");
      process.exit(2);
    }

    // Verify all 3 providers exist
    const lines = output1.split("\n");
    // Filter for actual provider rules, not the load statement
    const providerLines = lines.filter((l) => l.trim().startsWith("node_importer_deps("));

    if (providerLines.length !== 3) {
      console.error(`Expected 3 providers, got ${providerLines.length}`);
      console.error("Output:");
      console.error(output1);
      console.error("\nProvider lines:");
      providerLines.forEach((l, i) => console.error(`${i}: ${l}`));
      process.exit(2);
    }

    // Verify each importer is represented
    if (!output1.includes("projects/apps/web")) {
      console.error("Missing apps/web importer");
      process.exit(2);
    }
    if (!output1.includes("projects/apps/api")) {
      console.error("Missing apps/api importer");
      process.exit(2);
    }
    if (!output1.includes("projects/libs/utils")) {
      console.error("Missing libs/utils importer");
      process.exit(2);
    }

    // Verify ordering is consistent (entries should be sorted by provider name)
    // Extract provider names from rules
    const providerNames = providerLines
      .map((l) => {
        const match = l.match(/name="([^"]+)"/);
        return match ? match[1] : "";
      })
      .filter(Boolean);

    // The provider names should already be in sorted order
    const sortedNames = [...providerNames].sort();
    const namesMatch = providerNames.every((name, i) => name === sortedNames[i]);

    if (!namesMatch) {
      console.error("Providers not in sorted order");
      console.error("Got:", providerNames);
      console.error("Expected:", sortedNames);
      process.exit(2);
    }
  });
});
