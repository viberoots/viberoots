#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("cpp-encoding", async (tmp, $) => {
  const out = path.join(tmp, "third_party", "providers", "TARGETS.cpp.auto");
  // Ensure any pre-existing committed file in the temp repo is removed
  await fs.remove(out);
  // Run sync; expect no provider files to be produced for C++
  await $({ cwd: tmp })`viberoots/build-tools/tools/buck/sync-providers.ts --lang cpp --no-glue`;
  const exists = await fs.pathExists(out);
  if (exists) {
    console.error("C++ provider sync should not create TARGETS.cpp.auto");
    process.exit(2);
  }
});
