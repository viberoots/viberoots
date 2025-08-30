#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./lib/test-helpers";

test("buck2 config uses TARGETS buildfile", async () => {
  await runInTemp("buck2-targets", async (tmp, _$) => {
    const cfg = await fsp.readFile(path.join(tmp, ".buckconfig"), "utf8");
    if (!/\[buildfile\][\s\S]*?name\s*=\s*TARGETS/m.test(cfg)) {
      console.error("Expected .buckconfig to include buildfile.name = TARGETS");
      process.exit(2);
    }
  });
});
