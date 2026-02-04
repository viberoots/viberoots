#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

test("go scaffold creates patches/go with placeholder patch", async () => {
  await runInTemp("go-scaffold-patches", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib --yes --path=libs/demo-lib`;
    const dir = path.join(_tmp, "libs", "demo-lib", "patches", "go");
    if (!(await exists(dir))) {
      console.error("expected patches/go directory to exist in scaffold");
      process.exit(2);
    }
    const files = await fsp.readdir(dir).catch(() => [] as string[]);
    if (!files.some((f) => f.endsWith(".patch"))) {
      console.error("expected a placeholder .patch file under patches/go");
      process.exit(2);
    }
  });
});
