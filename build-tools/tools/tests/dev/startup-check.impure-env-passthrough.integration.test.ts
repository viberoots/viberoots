#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("startup-check verifies impure env passthrough for BUCK_TARGET", async () => {
  const txt = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/startup-check.ts"),
    "utf8",
  );
  if (!txt.includes('builtins.getEnv "BUCK_TARGET"')) {
    throw new Error("startup-check.ts must probe BUCK_TARGET passthrough via nix eval --impure");
  }
  if (!txt.includes("impure env passthrough is blocked for BUCK_TARGET")) {
    throw new Error("startup-check.ts must fail with a clear impure-env passthrough error");
  }
});
