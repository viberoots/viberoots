#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("install-deps wires node patch requirement warnings in local flow", async () => {
  const file = viberootsSourcePath("viberoots/build-tools/tools/dev/install/deps-main.ts");
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("warnNodePatchRequirementsInLocal(repoRoot)")) {
    throw new Error(`${file} must invoke warnNodePatchRequirementsInLocal(repoRoot)`);
  }
});
