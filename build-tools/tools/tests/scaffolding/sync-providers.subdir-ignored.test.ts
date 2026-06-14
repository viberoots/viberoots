#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { providerAutoTargetsPath } from "../../lib/workspace-state-paths";

test("sync-providers: subdirectory under patches/node is ignored (non-strict)", async () => {
  await runInTemp("sync-subdir", async (tmp, $) => {
    const sub = path.join(tmp, "patches", "node", "foo");
    await fsp.mkdir(sub, { recursive: true });
    await $`node build-tools/tools/buck/sync-providers.ts --lang node`;
    const txt = await fsp
      .readFile(path.join(tmp, providerAutoTargetsPath("node")), "utf8")
      .catch(() => "");
    if (!txt.includes("GENERATED FILE — DO NOT EDIT.")) {
      console.error("expected generated header even with no patches");
      process.exit(2);
    }
  });
});
