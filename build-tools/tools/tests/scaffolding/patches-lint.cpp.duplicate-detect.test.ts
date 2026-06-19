#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patches-lint (cpp): duplicate nixAttr@version detected in strict mode", async () => {
  await runInTemp("patches-lint-cpp-dup", async (tmp, $) => {
    const dir = path.join(tmp, "patches", "cpp");
    await fsp.mkdir(dir, { recursive: true });
    // Same logical key via multi-underscore variant (both decode to pkgs.zlib)
    await fsp.writeFile(path.join(dir, "pkgs__zlib@1.2.13.patch"), "# one\n", "utf8");
    await fsp.writeFile(path.join(dir, "pkgs____zlib@1.2.13.patch"), "# two\n", "utf8");

    const res = await $({
      nothrow: true,
    })`node viberoots/build-tools/tools/dev/patches-lint.ts --lang cpp --strict`;
    if (res.exitCode === 0) {
      console.error("expected strict lint to fail due to duplicate module key");
      process.exit(2);
    }
  });
});
