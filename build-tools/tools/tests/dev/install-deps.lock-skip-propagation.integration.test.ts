#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("install-deps propagates INSTALL_LOCK_SKIP while holding outer lock", async () => {
  const depsMain = await fsp.readFile(
    "viberoots/build-tools/tools/dev/install/deps-main.ts",
    "utf8",
  );
  if (!depsMain.includes("const prevInstallLockSkip = process.env.INSTALL_LOCK_SKIP;")) {
    throw new Error("deps-main.ts must preserve prior INSTALL_LOCK_SKIP before lock-held work");
  }
  if (!depsMain.includes('process.env.INSTALL_LOCK_SKIP = "1";')) {
    throw new Error("deps-main.ts must set INSTALL_LOCK_SKIP while holding node-modules lock");
  }
  if (!depsMain.includes("if (prevInstallLockSkip === undefined)")) {
    throw new Error("deps-main.ts must restore INSTALL_LOCK_SKIP after lock-held work");
  }
});
