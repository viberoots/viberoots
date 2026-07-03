#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("node planner mkApp prefers shared nodeMods and keeps compat fallback", async () => {
  const file = viberootsSourcePath("viberoots/build-tools/tools/nix/planner/node.nix");
  const appFile = viberootsSourcePath("viberoots/build-tools/tools/nix/planner/node-app.nix");
  const txt = await fsp.readFile(file, "utf8");
  const appTxt = await fsp.readFile(appFile, "utf8");

  if (!txt.includes("sharedNodeMods = ctx.nodeMods or null;")) {
    throw new Error(`${file} must expose ctx.nodeMods as sharedNodeMods`);
  }
  if (!appTxt.includes("if sharedNodeMods != null then sharedNodeMods")) {
    throw new Error(`${appFile} mkApp must prefer shared nodeMods when provided`);
  }
  if (!appTxt.includes("ctx.nodeMods not provided; using compat local node-modules import")) {
    throw new Error(
      `${appFile} must keep explicit compat fallback trace when ctx.nodeMods is absent`,
    );
  }
  if (!appTxt.includes("import ../node-modules.nix")) {
    throw new Error(`${appFile} must keep local node-modules import fallback for external callers`);
  }
});
