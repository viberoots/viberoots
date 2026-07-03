#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("install-deps --verbose enables lock diagnostics", async () => {
  const file = viberootsSourcePath("viberoots/build-tools/tools/dev/install/deps-main.ts");
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("[install-deps] acquiring node-modules install lock...")) {
    throw new Error("deps-main.ts must log lock acquisition in verbose mode");
  }
  if (!txt.includes("[install-deps] lock acquired")) {
    throw new Error("deps-main.ts must log when install lock is acquired");
  }
  if (!txt.includes('verbose || String(process.env.INSTALL_LOCK_VERBOSE || "").trim() === "1"')) {
    throw new Error("deps-main.ts must pass --verbose through to lock diagnostics");
  }
});
