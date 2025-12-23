#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-node: synthetic lockfile providers are opt-in", async () => {
  await runInTemp("providers-node-synth-opt-in", async (tmp, $) => {
    await $`git init`;

    // Keep the fixture focused: remove any repo-root pnpm-lock.yaml copied into the temp workspace
    // so default provider sync yields an empty providers file.
    await fsp.rm(path.join(tmp, "pnpm-lock.yaml"), { force: true });

    const importerDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(importerDir, { recursive: true });
    await fsp.writeFile(
      path.join(importerDir, "package.json"),
      JSON.stringify({ name: "demo", private: true }, null, 2) + "\n",
      "utf8",
    );
    await $`git add apps/demo/package.json`;

    // Default behavior: no provider for non-existent lockfiles
    await $`node tools/buck/sync-providers.ts --lang node --no-glue`;
    const outPath = path.join(tmp, "third_party", "providers", "TARGETS.node.auto");
    const outDefault = await fsp.readFile(outPath, "utf8");
    assert.ok(!outDefault.includes("node_importer_deps("), "expected no node providers by default");
    assert.ok(
      !outDefault.includes("apps/demo/pnpm-lock.yaml"),
      "expected no synthetic lockfile path by default",
    );

    // Opt-in behavior: metadata-only provider keyed by synthetic lockfile path
    await $`NODE_PROVIDER_SYNTHETIC_LOCKFILES=1 node tools/buck/sync-providers.ts --lang node --no-glue`;
    const outSynth = await fsp.readFile(outPath, "utf8");
    assert.ok(outSynth.includes("node_importer_deps("), "expected node provider in synthetic mode");
    assert.ok(
      outSynth.includes('lockfile="apps/demo/pnpm-lock.yaml"'),
      "expected synthesized lockfile path in synthetic mode",
    );
    assert.ok(
      outSynth.includes('importer="apps/demo"'),
      "expected importer label in synthetic mode",
    );
  });
});
