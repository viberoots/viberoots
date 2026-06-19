#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patches-lint (cpp): invalid filename shapes fail in strict mode", async () => {
  await runInTemp("patches-lint-cpp-shape", async (tmp, $) => {
    const dir = path.join(tmp, "patches", "cpp");
    await fsp.mkdir(dir, { recursive: true });
    // Missing @ separator
    await fsp.writeFile(path.join(dir, "pkgs__zlib.patch"), "# bad (missing @)\n", "utf8");
    // Wrong extension
    await fsp.writeFile(path.join(dir, "pkgs__openssl@3.0.0.txt"), "# wrong ext\n", "utf8");
    // Empty version
    await fsp.writeFile(path.join(dir, "pkgs__openssl@.patch"), "# empty version\n", "utf8");
    // Unencoded '.' present in prefix
    await fsp.writeFile(path.join(dir, "pkgs.openssl@3.0.0.patch"), "# dot in prefix\n", "utf8");

    const res = await $({
      nothrow: true,
    })`node viberoots/build-tools/tools/dev/patches-lint.ts --lang cpp --strict`;
    if (res.exitCode === 0) {
      console.error("expected strict lint to fail due to filename shape errors");
      process.exit(2);
    }
  });
});
