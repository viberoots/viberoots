#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";

test("runInTemp seed repo does not leak mutations across temp repos", async () => {
  // Force the seed path so this test exercises the PR-1 implementation even on platforms
  // that don't support CoW clones.
  const prevForce = process.env.TEST_FORCE_SEED_REPO;
  process.env.TEST_FORCE_SEED_REPO = "1";
  try {
    const realRepoRoot = process.cwd();
    const targetRel = "abstractions.md";
    const realPath = path.join(realRepoRoot, targetRel);
    const original = await fsp.readFile(realPath, "utf8");

    await runInTemp("seed-isolation-1", async (tmp) => {
      const p = path.join(tmp, targetRel);
      await fsp.appendFile(p, "\nseed-isolation-test: mutated\n", "utf8");
    });

    await runInTemp("seed-isolation-2", async (tmp) => {
      const p = path.join(tmp, targetRel);
      const now = await fsp.readFile(p, "utf8");
      assert.equal(
        now,
        original,
        "expected second temp repo to start from a clean seed (no mutation leakage)",
      );
    });
  } finally {
    if (prevForce === undefined) delete process.env.TEST_FORCE_SEED_REPO;
    else process.env.TEST_FORCE_SEED_REPO = prevForce;
  }
});
