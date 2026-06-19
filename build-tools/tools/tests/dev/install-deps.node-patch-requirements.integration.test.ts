#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("install-deps wires node patch requirement warnings in local flow", async () => {
  const file = "viberoots/build-tools/tools/dev/install/deps-main.ts";
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("warnNodePatchRequirementsInLocal(repoRoot)")) {
    throw new Error(`${file} must invoke warnNodePatchRequirementsInLocal(repoRoot)`);
  }
});
