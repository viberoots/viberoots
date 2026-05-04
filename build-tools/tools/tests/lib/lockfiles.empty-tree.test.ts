#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { findPnpmLockfiles } from "../../lib/lockfiles";

test("lockfiles: empty tree returns []", async () => {
  await runInTemp("lockfiles-empty", async (tmp, _$) => {
    process.chdir(tmp);
    const found = await findPnpmLockfiles({ roots: ["apps", "libs"] });
    if (found.length !== 0) {
      console.error("expected no lockfiles, got:", found);
      process.exit(2);
    }
  });
});
