#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";

test("runInTemp emits setup timing buckets in summary mode", async () => {
  const prevTiming = process.env.TEST_TIMING;
  try {
    process.env.TEST_TIMING = "summary";
    const { runInTemp, getTimingCountForLabel } = await import("./test-helpers");
    await runInTemp("setup-timing-smoke", async () => {});

    assert.equal(getTimingCountForLabel("runInTemp resolveTestHome"), 1);
    assert.equal(getTimingCountForLabel("runInTemp initTempRepoFromSeedStore"), 1);
    assert.equal(getTimingCountForLabel("runInTemp ensureBuckConfigForTempRepo"), 1);
    assert.equal(getTimingCountForLabel("runInTemp testBody"), 1);
  } finally {
    if (prevTiming === undefined) delete process.env.TEST_TIMING;
    else process.env.TEST_TIMING = prevTiming;
  }
});
