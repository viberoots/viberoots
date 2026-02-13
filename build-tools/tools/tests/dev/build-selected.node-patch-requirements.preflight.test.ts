#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("build-selected runs node patch requirement preflight", async () => {
  const file = "build-tools/tools/dev/build-selected.ts";
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("enforce-node-patch-requirements.ts")) {
    throw new Error(`${file} must run enforce-node-patch-requirements.ts before nix build`);
  }
  if (!txt.includes('args: ["--check"]')) {
    throw new Error(`${file} must pass --check for read-only preflight`);
  }
});
