#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patches-lint (python): importer subdirectory warns (non-strict) and fails (strict)", async () => {
  await runInTemp("patches-lint-python-subdir", async (tmp, $) => {
    // Create an importer with uv.lock
    const imp = path.join(tmp, "apps", "web");
    await fsp.mkdir(imp, { recursive: true });
    await fsp.writeFile(path.join(imp, "uv.lock"), "# uv lock", "utf8");
    // Create a subdirectory under importer-local patches/python
    const sub = path.join(imp, "patches", "python", "foo");
    await fsp.mkdir(sub, { recursive: true });
    // Non-strict: should warn but exit 0
    const resWarn = await $({
      nothrow: true,
    })`node viberoots/build-tools/tools/dev/patches-lint.ts --lang python`;
    if (resWarn.exitCode !== 0) {
      console.error("expected non-strict lint to succeed despite subdir (python)");
      process.exit(2);
    }
    // Strict: should fail due to subdir
    const resStrict = await $({
      nothrow: true,
    })`node viberoots/build-tools/tools/dev/patches-lint.ts --lang python --strict`;
    if (resStrict.exitCode === 0) {
      console.error("expected strict lint to fail due to subdir (python)");
      process.exit(2);
    }
  });
});
