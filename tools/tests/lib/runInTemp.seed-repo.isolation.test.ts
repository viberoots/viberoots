#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { mktemp, rsyncRepoTo, runInTemp } from "./test-helpers";

test("runInTemp seed repo does not leak mutations across temp repos", async () => {
  const prevSeed = process.env.BNX_TEST_SEED_STORE_PATH;
  const prevKey = process.env.BNX_TEST_SEED_KEY;
  try {
    const seedDir = await mktemp("seed-store-");
    await rsyncRepoTo(seedDir);
    const $seed = $({ cwd: seedDir, stdio: "pipe" });
    await $seed`git -c init.defaultBranch=main -c advice.defaultBranchName=false init -q`;
    await $seed`git add -A`;
    await $seed`git -c user.name=seed -c user.email=seed@example.com commit -q -m seed --allow-empty`;
    process.env.BNX_TEST_SEED_STORE_PATH = seedDir;
    process.env.BNX_TEST_SEED_KEY = "seed-store-test";

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
    if (prevSeed === undefined) delete process.env.BNX_TEST_SEED_STORE_PATH;
    else process.env.BNX_TEST_SEED_STORE_PATH = prevSeed;
    if (prevKey === undefined) delete process.env.BNX_TEST_SEED_KEY;
    else process.env.BNX_TEST_SEED_KEY = prevKey;
  }
});
