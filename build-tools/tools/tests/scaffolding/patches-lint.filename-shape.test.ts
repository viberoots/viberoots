#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patches-lint: invalid filename shapes fail in strict mode", async () => {
  await runInTemp("patches-lint-shape", async (tmp, $) => {
    const dir = path.join(tmp, "patches", "go");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "missing-at-separator.patch"), "# bad\n", "utf8");
    await fsp.writeFile(
      path.join(dir, "github.com__acme__widget@v1.2.3.txt"),
      "# wrong ext\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(dir, "github.com__acme__widget@.patch"),
      "# empty version\n",
      "utf8",
    );
    let failed = false;
    try {
      await $({ stdio: "pipe" })`node build-tools/tools/dev/patches-lint.ts --strict`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("expected strict lint to fail due to filename shape errors");
      process.exit(2);
    }
  });
});
