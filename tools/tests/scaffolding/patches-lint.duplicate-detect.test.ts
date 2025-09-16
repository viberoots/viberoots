#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patches-lint: duplicate module@version detected in strict mode", async () => {
  await runInTemp("patches-lint-dup", async (tmp, $) => {
    const dir = path.join(tmp, "patches", "go");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "github.com__acme__widget@v1.2.3.patch"), "# one\n", "utf8");
    // Duplicate for same module key (case variant)
    await fsp.writeFile(path.join(dir, "github.com__Acme__widget@v1.2.3.patch"), "# two\n", "utf8");
    let failed = false;
    try {
      await $({ stdio: "pipe" })`node tools/dev/patches-lint.ts --strict`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("expected strict lint to fail due to duplicate module key");
      process.exit(2);
    }
  });
});
