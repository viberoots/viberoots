#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { buildToolsRoot } from "../../dev/dev-build/paths";

const viberootsRoot = path.resolve(buildToolsRoot(process.cwd()), "..");

test("README references handbook and stage runner", async () => {
  const txt = await fs.readFile(path.join(viberootsRoot, "README.md"), "utf8");
  if (!txt.includes("docs/handbook/")) {
    console.error("README missing handbook link");
    process.exit(2);
  }
  if (!txt.includes("build-tools/tools/ci/run-stage.ts")) {
    console.error("README missing stage runner reference");
    process.exit(2);
  }
});
