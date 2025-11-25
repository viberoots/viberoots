#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patches-lint (python): duplicate name@version detected per importer in strict mode", async () => {
  await runInTemp("patches-lint-python-dup", async (tmp, $) => {
    // Create an importer with uv.lock
    const imp = path.join(tmp, "apps", "api");
    await fsp.mkdir(imp, { recursive: true });
    await fsp.writeFile(path.join(imp, "uv.lock"), "# uv lock", "utf8");
    const dir = path.join(imp, "patches", "python");
    await fsp.mkdir(dir, { recursive: true });
    // Two filenames that both decode to "acme/widget@1.2.3"
    await fsp.writeFile(path.join(dir, "acme__widget@1.2.3.patch"), "# one\n", "utf8");
    await fsp.writeFile(path.join(dir, "acme____widget@1.2.3.patch"), "# two\n", "utf8");
    const res = await $({ nothrow: true })`node tools/dev/patches-lint.ts --lang python --strict`;
    if (res.exitCode === 0) {
      console.error("expected strict lint to fail due to duplicate module key (python)");
      process.exit(2);
    }
  });
});
