#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("flake outputs split light and heavy per-system contexts", async () => {
  const outputsFile = "build-tools/tools/nix/flake/workspace.nix";
  const sysFile = "build-tools/tools/nix/flake/for-all-systems.nix";
  const ctxFile = "build-tools/tools/nix/flake/per-system-context.nix";

  const [outputsTxt, sysTxt, ctxTxt] = await Promise.all([
    fsp.readFile(outputsFile, "utf8"),
    fsp.readFile(sysFile, "utf8"),
    fsp.readFile(ctxFile, "utf8"),
  ]);

  if (!outputsTxt.includes("apps = sys.forAllSystemsLight")) {
    throw new Error(`${outputsFile} must build apps from the light context`);
  }
  if (!outputsTxt.includes("devShells = sys.forAllSystemsLight")) {
    throw new Error(`${outputsFile} must build devShells from the light context`);
  }
  if (!outputsTxt.includes("packages = sys.forAllSystemsHeavy")) {
    throw new Error(`${outputsFile} must build packages from the heavy context`);
  }
  if (!outputsTxt.includes("checks = sys.forAllSystemsHeavy")) {
    throw new Error(`${outputsFile} must build checks from the heavy context`);
  }

  if (!sysTxt.includes("forAllSystemsLight")) {
    throw new Error(`${sysFile} must define forAllSystemsLight`);
  }
  if (!sysTxt.includes("forAllSystemsHeavy")) {
    throw new Error(`${sysFile} must define forAllSystemsHeavy`);
  }
  if (!sysTxt.includes("mk system false")) {
    throw new Error(`${sysFile} light context must disable nodeMods`);
  }
  if (!sysTxt.includes("mk system true")) {
    throw new Error(`${sysFile} heavy context must enable nodeMods`);
  }

  if (!ctxTxt.includes("includeNodeMods ? false")) {
    throw new Error(`${ctxFile} must default includeNodeMods to false`);
  }
  if (!ctxTxt.includes("mkNodeMods")) {
    throw new Error(`${ctxFile} must expose a lazy mkNodeMods constructor`);
  }
  if (!ctxTxt.includes("if includeNodeMods then { nodeMods = mkNodeMods { }; } else { }")) {
    throw new Error(`${ctxFile} must gate nodeMods creation on includeNodeMods`);
  }
  if (!ctxTxt.includes("uvPathStr")) {
    throw new Error(`${ctxFile} must keep uv2nix path handling string-based for missing dirs`);
  }
  if (!ctxTxt.includes("builtins.pathExists uvPathStr")) {
    throw new Error(`${ctxFile} must check uv2nix existence via pathExists on uvPathStr`);
  }
});
