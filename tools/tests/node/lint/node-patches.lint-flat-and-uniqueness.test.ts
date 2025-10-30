#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../../lib/test-helpers";

test("node patches lint warns in non-strict and fails in strict mode", async () => {
  await runInTemp("node-patches-lint", async (tmp, $) => {
    // Create patches/node with a valid file, a subdir, and a non-patch file
    const dir = path.join(tmp, "patches/node");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "scoped__pkg@1.0.0.patch"), "# dummy patch\n", "utf8");
    await fsp.mkdir(path.join(dir, "bad"), { recursive: true });
    await fsp.writeFile(path.join(dir, "README.txt"), "not a patch\n", "utf8");
    // Invalid filename (missing @version) to trigger filename_shape violation
    await fsp.writeFile(path.join(dir, "scoped__pkg.patch"), "# missing version part\n", "utf8");

    // Non-strict: should emit warnings but exit 0
    const resWarn = await $({ nothrow: true })`node tools/dev/patches-lint.ts --lang node`;
    if (resWarn.exitCode !== 0) {
      console.error("Expected exit code 0 in non-strict mode, got:", resWarn.exitCode);
      process.exit(2);
    }

    // Strict: should exit non-zero due to subdir and bad filename
    const resStrict = await $({
      nothrow: true,
    })`node tools/dev/patches-lint.ts --lang node --strict`;
    if (resStrict.exitCode === 0) {
      console.error("Expected non-zero exit code in strict mode");
      process.exit(2);
    }
  });
});
