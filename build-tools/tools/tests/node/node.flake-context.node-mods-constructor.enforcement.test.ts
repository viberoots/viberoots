#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("flake package callsites resolve nodeMods from nodeMods or mkNodeMods", async () => {
  const defaultFile = "viberoots/build-tools/tools/nix/flake/packages/default.nix";
  const graphFile = "viberoots/build-tools/tools/nix/flake/packages/graph.nix";
  const checksFile = "viberoots/build-tools/tools/nix/flake/outputs-checks.nix";

  const [defaultTxt, graphTxt, checksTxt] = await Promise.all([
    fsp.readFile(defaultFile, "utf8"),
    fsp.readFile(graphFile, "utf8"),
    fsp.readFile(checksFile, "utf8"),
  ]);

  if (!defaultTxt.includes("nodeMods ? null")) {
    throw new Error(`${defaultFile} must accept optional nodeMods`);
  }
  if (!defaultTxt.includes("mkNodeMods ? null")) {
    throw new Error(`${defaultFile} must accept optional mkNodeMods`);
  }
  if (!defaultTxt.includes("resolvedNodeMods")) {
    throw new Error(`${defaultFile} must define resolvedNodeMods`);
  }
  if (!defaultTxt.includes("then mkNodeMods { }")) {
    throw new Error(`${defaultFile} must construct nodeMods from mkNodeMods when needed`);
  }
  if (!defaultTxt.includes("nodeMods = resolvedNodeMods;")) {
    throw new Error(`${defaultFile} must pass resolvedNodeMods to node package callsites`);
  }

  if (!graphTxt.includes("nodeMods ? null")) {
    throw new Error(`${graphFile} must accept optional nodeMods`);
  }
  if (!graphTxt.includes("mkNodeMods ? null")) {
    throw new Error(`${graphFile} must accept optional mkNodeMods`);
  }
  if (!graphTxt.includes("resolvedNodeMods")) {
    throw new Error(`${graphFile} must define resolvedNodeMods`);
  }
  if (!graphTxt.includes("nodeMods = resolvedNodeMods;")) {
    throw new Error(`${graphFile} must pass resolvedNodeMods into graph-generator`);
  }

  if (!checksTxt.includes("nodeMods ? null")) {
    throw new Error(`${checksFile} must accept optional nodeMods`);
  }
  if (!checksTxt.includes("mkNodeMods ? null")) {
    throw new Error(`${checksFile} must accept optional mkNodeMods`);
  }
  if (!checksTxt.includes("default = resolvedNodeMods.node-modules;")) {
    throw new Error(`${checksFile} must resolve default check from resolvedNodeMods`);
  }
});
