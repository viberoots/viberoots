#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerAutoTargetsPath } from "../../../lib/workspace-state-paths";
import { runInTemp } from "../../lib/test-helpers";

test("node provider includes patch only for importer's effective set after patch appears", async () => {
  await runInTemp("node-behavioral-apply", async (tmp, $) => {
    await $`git init`;

    // Importer with lodash dependency
    const lf = path.join(tmp, "projects/apps/example/pnpm-lock.yaml");
    await fsp.mkdir(path.dirname(lf), { recursive: true });
    await fsp.writeFile(
      lf,
      `lockfileVersion: "9.0"\nimporters:\n  projects/apps/example:\n    dependencies:\n      lodash:\n        specifier: ^4.17.21\n        version: 4.17.21\npackages:\n  /lodash/4.17.21:\n    resolution: { integrity: sha512-... }\n`,
      "utf8",
    );
    await $`git add projects/apps/example/pnpm-lock.yaml`;

    // Initial sync: no patches referenced
    await $`node viberoots/build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;
    const outPath = path.join(tmp, providerAutoTargetsPath("node"));
    const before = await fsp.readFile(outPath, "utf8");
    if (!before.includes('importer="projects/apps/example"')) {
      console.error("Expected provider entry for projects/apps/example");
      process.exit(2);
    }
    if (/patch_paths=\[.*lodash@4\.17\.21\.patch/.test(before)) {
      console.error("Unexpected lodash patch path before it exists");
      process.exit(2);
    }

    // Add a matching patch file
    const patchDir = path.join(tmp, "patches/node");
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(patchDir, "lodash@4.17.21.patch"), "# dummy patch\n", "utf8");

    // Sync again: provider should now include the patch path
    await $`node viberoots/build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;
    const after = await fsp.readFile(outPath, "utf8");
    if (!/patch_paths=\[[^\]]*patches\/node\/lodash@4\.17\.21\.patch/.test(after)) {
      console.error("Expected lodash patch path in provider entry after patch added");
      console.error(after);
      process.exit(2);
    }
  });
});
