#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp, exists } from "../lib/test-helpers";
import * as path from "node:path";

test("auto_map generated for scaffolded repo (may be empty)", async () => {
  await runInTemp("scaf-automap-smoke", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib --yes`;
    await $`build`;
    const p = path.join(process.cwd(), "third_party", "providers", "auto_map.bzl");
    if (!(await exists(p))) {
      console.error("auto_map.bzl missing after build");
      process.exit(2);
    }
  });
});
