#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

test("gen-provider-index: writes provider_index.bzl deterministically", async () => {
  await runInTemp("gen-provider-index", async (tmp, $) => {
    // Write a tiny patches/go example to create one Go provider
    const patchesDir = path.join(tmp, "patches", "go");
    await fsp.mkdir(patchesDir, { recursive: true });
    await fsp.writeFile(
      path.join(patchesDir, "golang.org__x__net@v0.24.0.patch"),
      "diff --git a/x b/x\n",
      "utf8",
    );

    // Run provider sync (Go) with index emission
    await $`node tools/buck/sync-providers.ts --lang go --emit-index=true`;

    const idx = path.join(tmp, "third_party", "providers", "provider_index.bzl");
    if (!(await exists(idx))) {
      console.error("provider_index.bzl missing");
      process.exit(2);
    }
    const txt = await fsp.readFile(idx, "utf8");
    if (!txt.includes("PROVIDER_INDEX = {")) {
      console.error("index missing header");
      process.exit(2);
    }
    if (!/\"kind\": \"go\"/.test(txt)) {
      console.error("expected at least one go entry");
      process.exit(2);
    }

    // Re-run to verify determinism (no-op write)
    const before = txt;
    await $`node tools/buck/sync-providers.ts --lang go --emit-index=true`;
    const after = await fsp.readFile(idx, "utf8");
    if (before !== after) {
      console.error("index not deterministic across runs");
      process.exit(2);
    }
  });
});
