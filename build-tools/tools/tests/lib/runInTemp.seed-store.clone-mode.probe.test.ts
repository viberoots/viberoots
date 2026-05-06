#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";

test("runInTemp seed store clone probe runs once per worker", async () => {
  const prevTiming = process.env.TEST_TIMING;
  try {
    assert.ok(
      process.env.BNX_TEST_SEED_STORE_PATH,
      "expected verifier to provide BNX_TEST_SEED_STORE_PATH",
    );
    process.env.TEST_TIMING = "summary";
    const { runInTemp, getTimingCountForLabel } = await import("./test-helpers");

    await runInTemp("seed-store-probe-1", async () => {});
    await runInTemp("seed-store-probe-2", async () => {});

    const label = "seedStore clone probe (copyFileCloneSupport)";
    assert.equal(getTimingCountForLabel(label), 1);
  } finally {
    if (prevTiming === undefined) delete process.env.TEST_TIMING;
    else process.env.TEST_TIMING = prevTiming;
  }
});
