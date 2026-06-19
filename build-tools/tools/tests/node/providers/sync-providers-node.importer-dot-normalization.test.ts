#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerAutoTargetsPath } from "../../../lib/workspace-state-paths";
import { runInTemp } from "../../lib/test-helpers";

test("sync-providers-node normalizes importer '.' to lockfile dirname", async () => {
  await runInTemp("node-importer-dot", async (tmp, $) => {
    await $`git init`;

    const lockfilePath = path.join(tmp, "projects/apps/example/pnpm-lock.yaml");
    const lockfileContent = `
lockfileVersion: "9.0"

importers:
  .:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

packages:
  /lodash/4.17.21:
    resolution: { integrity: sha512-... }
`.trim();

    await fsp.mkdir(path.dirname(lockfilePath), { recursive: true });
    await fsp.writeFile(lockfilePath, lockfileContent, "utf8");
    await $`git add projects/apps/example/pnpm-lock.yaml`;

    await $`node viberoots/build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;

    const outPath = path.join(tmp, providerAutoTargetsPath("node"));
    const output = await fsp.readFile(outPath, "utf8");

    if (!output.includes('importer="projects/apps/example"')) {
      console.error("Expected importer to be normalized to projects/apps/example");
      console.error(output);
      process.exit(2);
    }

    if (
      output.includes('lockfile="projects/apps/example/pnpm-lock.yaml", importer="."') ||
      output.includes('lockfile="projects/apps/example/pnpm-lock.yaml",importer="."')
    ) {
      console.error(
        "Importer '.' should not appear for projects/apps/example lockfile provider entry",
      );
      process.exit(2);
    }
  });
});
