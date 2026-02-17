#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("link-node pins resolved node_modules outPath as a gc root", async () => {
  const mainTxt = await fsp.readFile("build-tools/tools/dev/install/link-node.ts", "utf8");
  const helperTxt = await fsp.readFile(
    "build-tools/tools/dev/install/link-node-helpers.ts",
    "utf8",
  );
  if (!mainTxt.includes("ensureNodeModulesGcRoot")) {
    throw new Error("link-node.ts must call gc root pin helper");
  }
  if (!helperTxt.includes("node-modules.${key}")) {
    throw new Error("link-node helper must use importer-scoped node-modules gc root path");
  }
  if (!helperTxt.includes("--query") || !helperTxt.includes("--deriver")) {
    throw new Error("link-node helper must resolve derivation path before pinning gc root");
  }
  if (!helperTxt.includes("--realise") || !helperTxt.includes("--add-root")) {
    throw new Error("link-node helper must pin gc root by realising the resolved derivation");
  }
});
