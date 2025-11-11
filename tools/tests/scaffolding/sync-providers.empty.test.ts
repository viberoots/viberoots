#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers: empty repo still generates minimal Node providers file when requested", async () => {
  await runInTemp("sync-empty", async (tmp, $) => {
    await $`node tools/buck/sync-providers.ts --lang node`;
    const txt = await fsp.readFile(`${tmp}/third_party/providers/TARGETS.node.auto`, "utf8");
    if (!txt.includes("GENERATED FILE — DO NOT EDIT.")) {
      console.error("missing header");
      process.exit(2);
    }
    if (!txt.includes('load("//third_party/providers:defs_node.bzl", "node_importer_deps")')) {
      console.error("missing node load line");
      process.exit(2);
    }
  });
});
