#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers: empty patches generates minimal TARGETS.auto", async () => {
  await runInTemp("sync-empty", async (tmp, $) => {
    await $`node tools/buck/sync-providers.ts --out third_party/providers/TARGETS.auto`;
    const txt = await fsp.readFile(`${tmp}/third_party/providers/TARGETS.auto`, "utf8");
    if (!txt.includes("GENERATED FILE — DO NOT EDIT.")) {
      console.error("missing header");
      process.exit(2);
    }
    if (!txt.includes('load("//third_party/providers:defs.bzl", "go_module_patch")')) {
      console.error("missing load line");
      process.exit(2);
    }
  });
});
