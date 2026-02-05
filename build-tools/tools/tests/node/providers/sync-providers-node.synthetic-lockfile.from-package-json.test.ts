#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../../lib/test-helpers";

test("sync-providers-node emits a metadata-only provider for workspace importers with package.json but no pnpm-lock.yaml", async () => {
  await runInTemp("node-synth-lock-from-pkgjson", async (tmp, $) => {
    await $`git init`;

    const importerDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(importerDir, { recursive: true });
    await fsp.writeFile(
      path.join(importerDir, "package.json"),
      JSON.stringify({ name: "demo", private: true }, null, 2) + "\n",
      "utf8",
    );
    await $`git add projects/apps/demo/package.json`;

    await $`NODE_PROVIDER_SYNTHETIC_LOCKFILES=1 node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;

    const outPath = path.join(tmp, "third_party", "providers", "TARGETS.node.auto");
    const out = await fsp.readFile(outPath, "utf8");

    if (!out.includes("node_importer_deps(")) {
      console.error("Expected node_importer_deps rule in output");
      console.error(out);
      process.exit(2);
    }
    if (!out.includes('lockfile="projects/apps/demo/pnpm-lock.yaml"')) {
      console.error("Expected synthesized lockfile path in output");
      console.error(out);
      process.exit(2);
    }
    if (!out.includes('importer="projects/apps/demo"')) {
      console.error("Expected importer in output");
      console.error(out);
      process.exit(2);
    }
  });
});
