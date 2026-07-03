#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("link-node can recover outPath from existing symlink when marker is missing", async () => {
  const mainFile = viberootsSourcePath("viberoots/build-tools/tools/dev/install/link-node.ts");
  const helperFile = viberootsSourcePath(
    "viberoots/build-tools/tools/dev/install/link-node-helpers.ts",
  );
  const main = await fsp.readFile(mainFile, "utf8");
  const helper = await fsp.readFile(helperFile, "utf8");
  if (!main.includes("recoverOutPathFromExistingSymlink")) {
    throw new Error("link-node.ts must include symlink-based outPath recovery helper");
  }
  if (!main.includes("recovered outPath from existing symlink for importer")) {
    throw new Error("link-node.ts must log symlink-recovery fast-path usage");
  }
  if (!helper.includes("outBase.includes(`-lock-${lockHash}`)")) {
    throw new Error("link-node helper must verify lock-hash binding in nix store path");
  }
});
