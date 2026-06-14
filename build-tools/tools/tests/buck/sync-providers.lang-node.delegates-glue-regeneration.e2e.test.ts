#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_GRAPH_PATH,
  DEFAULT_PROVIDER_INDEX_PATH,
  providerAutoTargetsPath,
} from "../../lib/workspace-state-paths";
import { exists, runInTemp } from "../lib/test-helpers";

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

    await $`node build-tools/tools/buck/sync-providers.ts --lang node`;

    assert.equal(await exists(path.join(tmp, DEFAULT_GRAPH_PATH)), true);
    assert.equal(await exists(path.join(tmp, DEFAULT_AUTO_MAP_PATH)), true);
    assert.equal(await exists(path.join(tmp, providerAutoTargetsPath("node"))), true);

    await $`node build-tools/tools/buck/sync-providers.ts --lang node --emit-index`;
    assert.equal(await exists(path.join(tmp, DEFAULT_PROVIDER_INDEX_PATH)), true);
  });
});
