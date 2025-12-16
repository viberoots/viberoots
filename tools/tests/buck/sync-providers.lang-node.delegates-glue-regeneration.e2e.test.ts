#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers.ts";

test("sync-providers --lang node regenerates downstream glue via the centralized pipeline", async () => {
  await runInTemp("sync-providers-node-glue", async (tmp, $) => {
    const importerDir = path.join(tmp, "apps", "web");
    await fsp.mkdir(importerDir, { recursive: true });
    await fsp.writeFile(
      path.join(importerDir, "package.json"),
      JSON.stringify({ name: "web", private: true }, null, 2) + "\n",
      "utf8",
    );
    // Minimal valid YAML; keep it parseable if yaml is present in the toolchain.
    await fsp.writeFile(
      path.join(importerDir, "pnpm-lock.yaml"),
      "lockfileVersion: 9.0\nimporters: {}\n",
      "utf8",
    );

    await $`node tools/buck/sync-providers.ts --lang node`;

    assert.equal(await exists(path.join(tmp, "tools", "buck", "graph.json")), true);
    assert.equal(await exists(path.join(tmp, "third_party", "providers", "auto_map.bzl")), true);

    await $`node tools/buck/sync-providers.ts --lang node --emit-index`;
    assert.equal(
      await exists(path.join(tmp, "third_party", "providers", "provider_index.bzl")),
      true,
    );
  });
});
