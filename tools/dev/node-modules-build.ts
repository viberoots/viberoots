#!/usr/bin/env zx-wrapper
import process from "node:process";
import { findNearestImporterLock, nodeModulesAttr } from "./install/common.ts";

const root = process.cwd();
const info = await findNearestImporterLock(root);
// Fallback to repo-root importer when none is found in the temp sandbox
const importer = info && info.importer ? info.importer : ".";
const fullAttr = nodeModulesAttr(importer);
const { stdout } =
  await $`nix build .#${fullAttr} --no-link --accept-flake-config --print-out-paths`;
const outPath =
  String(stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop() || "";
if (!outPath) {
  console.error("node-modules-build: nix build produced no output path");
  process.exit(2);
}
console.log(outPath);
