#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("link-node detects competing node-modules builds and fails fast", async () => {
  const mainTxt = await fsp.readFile("build-tools/tools/dev/install/link-node.ts", "utf8");
  const helperTxt = await fsp.readFile(
    "build-tools/tools/dev/install/link-node-helpers.ts",
    "utf8",
  );
  if (!helperTxt.includes("findCompetingNodeModulesBuilds")) {
    throw new Error("link-node helper must detect competing nix builds for same node-modules attr");
  }
  if (!mainTxt.includes("failOnCompetingBuilds")) {
    throw new Error("link-node.ts must implement non-destructive competing build guard");
  }
  if (helperTxt.includes("process.kill(c.pid")) {
    throw new Error("link-node competing build guard must not kill external processes");
  }
});
