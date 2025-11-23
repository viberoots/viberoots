#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patches-lint: duplicate module@version detected in strict mode", async () => {
  await runInTemp("patches-lint-dup", async (tmp, $) => {
    const dir = path.join(tmp, "patches", "go");
    await fsp.mkdir(dir, { recursive: true });
    // Create two distinct filenames that both decode to the same "import@version" key.
    // decodeFromPatchFilename collapses groups of 2+ underscores to a single '/', so the following
    // both decode to "github.com/acme/widget@v1.2.3" regardless of filesystem case sensitivity.
    await fsp.writeFile(
      path.join(dir, "github.com____acme__widget@v1.2.3.patch"),
      "# one\n",
      "utf8",
    ); // "____" -> "/"
    await fsp.writeFile(
      path.join(dir, "github.com__acme____widget@v1.2.3.patch"),
      "# two\n",
      "utf8",
    ); // "____" -> "/"
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
