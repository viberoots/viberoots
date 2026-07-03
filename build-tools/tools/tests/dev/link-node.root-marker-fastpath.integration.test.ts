#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("link-node root importer supports marker fast-path", async () => {
  const file = viberootsSourcePath("viberoots/build-tools/tools/dev/install/link-node.ts");
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("using marker fast-path for importer")) {
    throw new Error("link-node.ts must log importer marker fast-path usage");
  }
  if (!txt.includes("marker.lockHash === lockHash")) {
    throw new Error("link-node.ts must validate lock hash before marker fast-path");
  }
  if (!txt.includes("symlinkMatches")) {
    throw new Error("link-node.ts must verify symlink target for marker fast-path");
  }
  if (!txt.includes("marker target valid; node_modules symlink will be corrected")) {
    throw new Error("link-node.ts must allow marker fast-path even when symlink needs correction");
  }
  if (!txt.includes("symlinkAlreadyCorrect = symlinkMatches")) {
    throw new Error("link-node.ts must remember when marker fast-path symlink is already correct");
  }
  if (!txt.includes("if (!symlinkAlreadyCorrect)")) {
    throw new Error("link-node.ts must avoid rewriting an already-correct node_modules symlink");
  }
});
