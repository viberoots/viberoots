#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp providers sync writes TARGETS.cpp.auto header", async () => {
  await runInTemp("cpp-overlays-sync", async (tmp, $) => {
    // Ensure providers dir exists
    await fs.mkdirp(path.join(tmp, "third_party/providers"));

    // Invoke provider sync for cpp only
    const script = path.join(process.cwd(), "tools/buck/sync-providers.ts");
    await $`node ${script} --lang=cpp`;

    const out = path.join(tmp, "third_party/providers/TARGETS.cpp.auto");
    const exists = await fs.pathExists(out);
    if (!exists) {
      console.error("expected TARGETS.cpp.auto to be written by sync-providers (cpp)");
      process.exit(2);
    }
    const txt = await fs.readFile(out, "utf8");
    if (!txt.includes("# GENERATED FILE — DO NOT EDIT.")) {
      console.error("expected generated header in TARGETS.cpp.auto");
      process.exit(2);
    }
  });
});
