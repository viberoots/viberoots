#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const VIBEROOTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test("startup-check read-only git calls disable optional locks", async () => {
  const source = await fsp.readFile(
    path.join(VIBEROOTS_ROOT, "build-tools/tools/dev/startup-check/workspace-state.ts"),
    "utf8",
  );

  assert.match(source, /GIT_OPTIONAL_LOCKS:\s*"0"/);
});
