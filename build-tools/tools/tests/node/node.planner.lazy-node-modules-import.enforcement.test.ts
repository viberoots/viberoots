#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node planner lazily imports node-modules inside mkApp", async () => {
  const file = "build-tools/tools/nix/planner/node.nix";
  const appFile = "build-tools/tools/nix/planner/node-app.nix";
  const txt = await fsp.readFile(file, "utf8");
  const appTxt = await fsp.readFile(appFile, "utf8");
  const topLevelLegacy = "# Local node-modules utilities (hermetic pnpm store + node_modules)";
  if (txt.includes(topLevelLegacy)) {
    throw new Error(`${file} must not import node-modules at planner module top-level`);
  }
  if (!txt.includes("mkApp = name: import ./node-app.nix")) {
    throw new Error(`${file} must delegate mkApp to node-app.nix`);
  }
  if (!appTxt.includes("import ../node-modules.nix")) {
    throw new Error(`${appFile} must keep node-modules import lazy inside mkApp path`);
  }
});
