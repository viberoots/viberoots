#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

await runInTemp("startup-check-buck-prelude", async (tmp, $) => {
  // Case 1: Missing .buckconfig → should fail
  await fs.remove(path.join(tmp, ".buckconfig")).catch(() => {});
  let failed = false;
  try {
    await $({ cwd: tmp })`tools/dev/startup-check.ts`;
  } catch {
    failed = true;
  }
  if (!failed) throw new Error("startup-check should fail when .buckconfig is missing");

  // Case 2: Present .buckconfig but missing prelude mapping → should fail
  await fs.writeFile(
    path.join(tmp, ".buckconfig"),
    [
      "[buildfile]",
      "name = TARGETS",
      "",
      "[repositories]",
      "root = .",
      "",
      "[cells]",
      "root = .",
      "",
    ].join("\n"),
    "utf8",
  );
  failed = false;
  try {
    await $({ cwd: tmp })`tools/dev/startup-check.ts`;
  } catch {
    failed = true;
  }
  if (!failed)
    throw new Error(
      "startup-check should fail when .buckconfig lacks prelude mapping in repositories/cells",
    );
});
