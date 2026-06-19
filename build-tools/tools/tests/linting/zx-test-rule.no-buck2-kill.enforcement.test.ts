#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("linting: zx_test runner must not call `buck2 kill` (daemon reuse policy)", async () => {
  const p = path.join(process.cwd(), "viberoots", "build-tools", "tools", "buck", "zx_test.bzl");
  const content = await fsp.readFile(p, "utf8");
  if (content.includes('buck2" kill') || content.includes("buck2 kill")) {
    throw new Error(`unexpected buck2 kill usage in ${p}`);
  }
  if (content.includes("ZX_TEST_KILL_DAEMON")) {
    throw new Error(`unexpected ZX_TEST_KILL_DAEMON knob in ${p}`);
  }
});
