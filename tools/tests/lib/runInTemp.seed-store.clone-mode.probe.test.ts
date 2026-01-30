#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";

test("runInTemp seed store clone probe runs once per worker", async () => {
  const prevSeed = process.env.BNX_TEST_SEED_STORE_PATH;
  const prevKey = process.env.BNX_TEST_SEED_KEY;
  const prevTiming = process.env.TEST_TIMING;
  try {
    process.env.TEST_TIMING = "summary";
    const { mktemp, rsyncRepoTo, runInTemp, getTimingCountForLabel } = await import(
      "./test-helpers"
    );
    const seedDir = await mktemp("seed-store-probe-");
    await rsyncRepoTo(seedDir);
    const $seed = $({ cwd: seedDir, stdio: "pipe" });
    await $seed`git -c init.defaultBranch=main -c advice.defaultBranchName=false init -q`;
    await $seed`git add -A`;
    await $seed`git -c user.name=seed -c user.email=seed@example.com commit -q -m seed --allow-empty`;
    process.env.BNX_TEST_SEED_STORE_PATH = seedDir;
    process.env.BNX_TEST_SEED_KEY = "seed-store-probe";

    await runInTemp("seed-store-probe-1", async () => {});
    await runInTemp("seed-store-probe-2", async () => {});

    const label = "seedStore clone probe (copyFileCloneSupport)";
    assert.equal(getTimingCountForLabel(label), 1);
  } finally {
    if (prevSeed === undefined) delete process.env.BNX_TEST_SEED_STORE_PATH;
    else process.env.BNX_TEST_SEED_STORE_PATH = prevSeed;
    if (prevKey === undefined) delete process.env.BNX_TEST_SEED_KEY;
    else process.env.BNX_TEST_SEED_KEY = prevKey;
    if (prevTiming === undefined) delete process.env.TEST_TIMING;
    else process.env.TEST_TIMING = prevTiming;
  }
});
