#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers: subdirectory under patches/go is ignored (non-strict)", async () => {
  await runInTemp("sync-subdir", async (tmp, $) => {
    const sub = path.join(tmp, "patches", "go", "foo");
    await fsp.mkdir(sub, { recursive: true });
    await $`node tools/buck/sync-providers.ts --out third_party/providers/TARGETS.auto`;
    const txt = await fsp
      .readFile(path.join(tmp, "third_party", "providers", "TARGETS.auto"), "utf8")
      .catch(() => "");
    if (!txt.includes("GENERATED FILE — DO NOT EDIT.")) {
      console.error("expected generated header even with no patches");
      process.exit(2);
    }
  });
});
