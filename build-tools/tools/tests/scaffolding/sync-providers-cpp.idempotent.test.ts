#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-cpp: second run is a no-op when inputs unchanged", async () => {
  await runInTemp("cpp-idem", async (tmp, $) => {
    const outFile = path.join(tmp, "third_party", "providers", "TARGETS.cpp.auto");

    await $`node build-tools/tools/buck/sync-providers.ts --lang cpp`;
    const exists1 = await fs.pathExists(outFile);
    if (exists1) {
      console.error("C++ sync should be a no-op; no TARGETS.cpp.auto should be created");
      process.exit(2);
    }

    // Second run should not modify the file contents
    await $`node build-tools/tools/buck/sync-providers.ts --lang cpp`;
    const exists2 = await fs.pathExists(outFile);
    if (exists2) {
      console.error("C++ sync should be a no-op on repeated runs as well");
      process.exit(2);
    }
  });
});
