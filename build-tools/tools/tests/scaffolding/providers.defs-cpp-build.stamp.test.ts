#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp providers sync is a no-op (no TARGETS.cpp.auto header)", async () => {
  await runInTemp("cpp-overlays-sync", async (tmp, $) => {
    const out = path.join(tmp, "third_party/providers/TARGETS.cpp.auto");
    // Remove any pre-existing committed file in the temp copy
    await fsp.rm(out, { force: true });
    // Invoke provider sync for cpp only (should be a no-op)
    await $`node viberoots/build-tools/tools/buck/sync-providers.ts --lang=cpp --no-glue`;
    let exists = false;
    try {
      await fsp.access(out);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists) {
      try {
        console.error("DEBUG third_party/providers listing:");
        const ls = await $({
          cwd: tmp,
          stdio: "pipe",
        })`bash --noprofile --norc -c 'ls -la third_party/providers'`;
        console.error(String(ls.stdout || "").trim());
      } catch {}
      try {
        console.error("DEBUG TARGETS.cpp.auto contents:");
        const txt = await fsp.readFile(out, "utf8");
        console.error((txt || "").slice(0, 2000));
      } catch {}
      console.error("C++ provider sync should not create TARGETS.cpp.auto");
      process.exit(2);
    }
  });
});
