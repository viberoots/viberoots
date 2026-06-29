#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("startup-check read-only git calls disable optional locks", async () => {
  const source = await fsp.readFile(
    "viberoots/build-tools/tools/dev/startup-check/workspace-state.ts",
    "utf8",
  );

  assert.match(source, /GIT_OPTIONAL_LOCKS:\s*"0"/);
});
