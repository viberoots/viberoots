#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import { test } from "node:test";

test("README references handbook and stage runner", async () => {
  const txt = await fs.readFile("README.md", "utf8");
  if (!txt.includes("docs/handbook/")) {
    console.error("README missing handbook link");
    process.exit(2);
  }
  if (!txt.includes("tools/ci/run-stage.ts")) {
    console.error("README missing stage runner reference");
    process.exit(2);
  }
});
