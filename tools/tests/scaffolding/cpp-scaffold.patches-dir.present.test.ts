#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

test("cpp scaffold creates patches/cpp with placeholder patch", async () => {
  await runInTemp("cpp-scaffold-patches", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`scaf new cpp lib core --yes --path=libs/core`;
    const dir = path.join(_tmp, "libs", "core", "patches", "cpp");
    if (!(await exists(dir))) {
      console.error("expected patches/cpp directory to exist in scaffold");
      process.exit(2);
    }
    const files = await fsp.readdir(dir).catch(() => [] as string[]);
    if (!files.some((f) => f.endsWith(".patch"))) {
      console.error("expected a placeholder .patch file under patches/cpp");
      process.exit(2);
    }
  });
});
