#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node planner lazily imports node-modules inside mkApp", async () => {
  const file = "build-tools/tools/nix/planner/node.nix";
  const txt = await fsp.readFile(file, "utf8");
  const topLevelLegacy = "# Local node-modules utilities (hermetic pnpm store + node_modules)";
  if (txt.includes(topLevelLegacy)) {
    throw new Error(`${file} must not import node-modules at planner module top-level`);
  }
  if (!txt.includes("mkApp = name:")) {
    throw new Error(`${file} must define mkApp`);
  }
  const mkAppIdx = txt.indexOf("mkApp = name:");
  const mkGenIdx = txt.indexOf("mkGen = name:");
  const mkAppBlock = mkAppIdx >= 0 ? txt.slice(mkAppIdx, mkGenIdx >= 0 ? mkGenIdx : undefined) : "";
  if (!mkAppBlock.includes("import ../node-modules.nix")) {
    throw new Error(`${file} must keep node-modules import lazy inside mkApp path`);
  }
});
