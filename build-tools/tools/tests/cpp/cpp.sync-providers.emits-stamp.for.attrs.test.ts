#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("sync-providers-cpp is a no-op (no provider files generated)", async () => {
  await runInTemp("cpp-sync-providers-basic", async (tmp, $) => {
    const out = path.join(tmp, "third_party/providers/TARGETS.cpp.auto");
    // Ensure any pre-existing committed file in the temp repo is removed
    await fs.remove(out);
    // Run the C++ providers sync scoped to tmp via the public CLI (should be a no-op)
    await $({
      cwd: tmp,
    })`node ${viberootsSourcePath("viberoots/build-tools/tools/buck/sync-providers.ts")} --lang=cpp`;
    const exists = await fs.pathExists(out);
    if (exists) {
      console.error("C++ provider sync should not create TARGETS.cpp.auto");
      process.exit(2);
    }
  });
});
