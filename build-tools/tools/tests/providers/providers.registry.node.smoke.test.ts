#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("providers registry: node sync generates importer-scoped provider from pnpm-lock.yaml", async () => {
  await runInTemp("providers-registry-node", async (tmp, $) => {
    // Synthesize a minimal importer with a pnpm-lock.yaml and a matching patch file
    const importer = path.join(tmp, "apps", "web");
    await fsp.mkdir(importer, { recursive: true });
    const lf = path.join(importer, "pnpm-lock.yaml");
    const lock = [
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    dependencies:",
      "      lodash: 4.17.21",
      "packages:",
      "  /lodash/4.17.21: {}",
      "",
    ].join("\n");
    await fsp.writeFile(lf, lock, "utf8");
    // Flat patch dir at repo root for '.' importer
    const patchDir = path.join(tmp, "patches", "node");
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(patchDir, "lodash@4.17.21.patch"), "# test patch\n", "utf8");

    // Run sync for node only
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`node build-tools/tools/buck/sync-providers.ts --lang node`;

    const out = path.join(tmp, "third_party", "providers", "TARGETS.node.auto");
    const txt = await fsp.readFile(out, "utf8");
    assert.ok(
      /node_importer_deps\s*\(/.test(txt),
      "expected node_importer_deps rule in TARGETS.node.auto",
    );
    assert.ok(
      /apps\/web\/pnpm-lock\.yaml/.test(txt),
      "expected lockfile path in generated provider",
    );
  });
});
