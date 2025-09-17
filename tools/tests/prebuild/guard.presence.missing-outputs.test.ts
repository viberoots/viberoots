#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: missing outputs warns locally and fails in CI", async () => {
  await runInTemp("prebuild-missing", async (tmp, $) => {
    // Ensure a patch exists to require provider autos
    await fsp.mkdir(path.join(tmp, "patches", "go"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "patches", "go", "example.com__mod@v0.0.1.patch"),
      "diff --git a/b b\n",
      "utf8",
    );
    // No outputs created
    // Local should not exit non-zero
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/prebuild-guard.ts`;
    // CI should fail
    let failed = false;
    try {
      await $({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, CI: "true" },
      })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/prebuild-guard.ts`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("expected CI mode to fail when outputs missing");
      process.exit(2);
    }
  });
});
