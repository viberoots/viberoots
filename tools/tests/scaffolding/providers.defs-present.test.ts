#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import * as fsp from "node:fs/promises";

test("third_party/providers/defs.bzl defines go_module_patch genrule", async () => {
  await runInTemp("providers-defs", async (tmp, $) => {
    const txt = await fsp.readFile("third_party/providers/defs.bzl", "utf8");
    if (!txt.includes("def go_module_patch(")) {
      console.error("missing go_module_patch definition");
      process.exit(2);
    }
    if (!txt.includes("genrule(")) {
      console.error("missing genrule in provider def");
      process.exit(2);
    }
  });
});
