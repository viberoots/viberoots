#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { getTimingCountForLabel, runInScratchTemp, runInTemp } from "./test-helpers";

test("runInTemp emits setup timing buckets in summary mode", async () => {
  const prevTiming = process.env.TEST_TIMING;
  try {
    process.env.TEST_TIMING = "summary";
    await runInTemp("setup-timing-smoke", async () => {});

    assert.equal(getTimingCountForLabel("runInTemp resolveTestHome"), 1);
    assert.equal(getTimingCountForLabel("runInTemp initTempRepoFromSeedStore"), 1);
    assert.equal(getTimingCountForLabel("runInTemp ensureBuckConfigForTempRepo"), 1);
    assert.equal(getTimingCountForLabel("runInTemp testBody"), 1);

    await runInScratchTemp("scratch-timing-smoke", async () => {});
    assert.equal(
      getTimingCountForLabel("runInTemp initTempRepoFromSeedStore"),
      1,
      "scratch temp workspaces must not seed-copy the repo",
    );
    assert.equal(
      getTimingCountForLabel("runInTemp ensureBuckConfigForTempRepo"),
      1,
      "scratch temp workspaces must not bootstrap Buck config",
    );
    assert.equal(getTimingCountForLabel("runInTemp testBody"), 2);
  } finally {
    if (prevTiming === undefined) delete process.env.TEST_TIMING;
    else process.env.TEST_TIMING = prevTiming;
  }
});
