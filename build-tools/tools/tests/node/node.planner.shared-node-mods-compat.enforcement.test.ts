#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node planner mkApp prefers shared nodeMods and keeps compat fallback", async () => {
  const file = "build-tools/tools/nix/planner/node.nix";
  const txt = await fsp.readFile(file, "utf8");

  if (!txt.includes("sharedNodeMods = ctx.nodeMods or null;")) {
    throw new Error(`${file} must expose ctx.nodeMods as sharedNodeMods`);
  }
  if (!txt.includes("if sharedNodeMods != null then sharedNodeMods")) {
    throw new Error(`${file} mkApp must prefer shared nodeMods when provided`);
  }
  if (!txt.includes("ctx.nodeMods not provided; using compat local node-modules import")) {
    throw new Error(`${file} must keep explicit compat fallback trace when ctx.nodeMods is absent`);
  }
  if (!txt.includes("import ../node-modules.nix")) {
    throw new Error(`${file} must keep local node-modules import fallback for external callers`);
  }
});
