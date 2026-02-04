#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";

test("runInTemp does not rewrite flake.lock", async () => {
  const repoRoot = process.cwd();
  const lockPath = path.join(repoRoot, "flake.lock");
  const original = await fsp.readFile(lockPath, "utf8");

  await runInTemp("flake-lock-no-rewrite", async (tmp) => {
    const tmpLockPath = path.join(tmp, "flake.lock");
    const tmpLock = await fsp.readFile(tmpLockPath, "utf8");
    assert.equal(tmpLock, original);
  });
});
