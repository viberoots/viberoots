#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_PROVIDER_INDEX_PATH } from "../../lib/workspace-state-paths";
import { exists, runInTemp } from "../lib/test-helpers";

test("gen-provider-index: writes provider_index.bzl deterministically", async () => {
  await runInTemp("gen-provider-index", async (tmp, $) => {
    // Generate provider index directly (Node/CPP entries only if present)
    await $`node viberoots/build-tools/tools/buck/gen-provider-index.ts --out ${DEFAULT_PROVIDER_INDEX_PATH}`;

    const idx = path.join(tmp, DEFAULT_PROVIDER_INDEX_PATH);
    if (!(await exists(idx))) {
      console.error("provider_index.bzl missing");
      process.exit(2);
    }
    const txt = await fsp.readFile(idx, "utf8");
    if (!txt.includes("PROVIDER_INDEX = {")) {
      console.error("index missing header");
      process.exit(2);
    }

    // Re-run to verify determinism (no-op write)
    const before = txt;
    await $`node viberoots/build-tools/tools/buck/gen-provider-index.ts --out ${DEFAULT_PROVIDER_INDEX_PATH}`;
    const after = await fsp.readFile(idx, "utf8");
    if (before !== after) {
      console.error("index not deterministic across runs");
      process.exit(2);
    }
  });
});
