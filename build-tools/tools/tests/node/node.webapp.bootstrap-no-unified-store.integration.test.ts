#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node_webapp bootstrap disables unified pnpm store setup", async () => {
  const txt = await fsp.readFile("build-tools/node/defs_nix.bzl", "utf8");
  if (!txt.includes("node_webapp(")) {
    throw new Error("defs_nix.bzl must define node_webapp macro");
  }
  if (!txt.includes("include_pnpm_store = False")) {
    throw new Error("node_webapp bootstrap must disable unified PNPM store setup");
  }
});
