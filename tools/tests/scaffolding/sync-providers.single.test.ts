#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers: single Node importer produces a provider entry", async () => {
  await runInTemp("sync-single-node", async (tmp, $) => {
    await $`git init`;
    const lockfilePath = path.join(tmp, "apps/example/pnpm-lock.yaml");
    await fsp.mkdir(path.dirname(lockfilePath), { recursive: true });
    await fsp.writeFile(
      lockfilePath,
      `lockfileVersion: "9.0"\nimporters:\n  apps/example:\n    dependencies: {}\npackages: {}`,
      "utf8",
    );
    await $`git add apps/example/pnpm-lock.yaml`;
    await $`node tools/buck/sync-providers.ts --lang node`;
    const txt = await fsp.readFile(
      path.join(tmp, "third_party", "providers", "TARGETS.node.auto"),
      "utf8",
    );
    if (!txt.includes("node_importer_deps")) {
      console.error("expected node_importer_deps entry");
      process.exit(2);
    }
  });
});
