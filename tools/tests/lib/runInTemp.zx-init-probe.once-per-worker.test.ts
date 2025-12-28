#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";

test("runInTemp zx-init probe runs once per worker", async () => {
  const prevTiming = process.env.TEST_TIMING;
  const prevForce = process.env.TEST_FORCE_ZX_INIT_PROBE;
  try {
    process.env.TEST_TIMING = "summary";
    delete process.env.TEST_FORCE_ZX_INIT_PROBE;

    const { runInTemp, getTimingCountForLabel } = await import("./test-helpers");
    const label = "zx-init probe (node --import zx-init)";

    await runInTemp("zx-init-probe-1", async (_tmp, _$) => {});
    await runInTemp("zx-init-probe-2", async (_tmp, _$) => {});

    assert.equal(getTimingCountForLabel(label), 1);
  } finally {
    if (prevTiming === undefined) delete process.env.TEST_TIMING;
    else process.env.TEST_TIMING = prevTiming;

    if (prevForce === undefined) delete process.env.TEST_FORCE_ZX_INIT_PROBE;
    else process.env.TEST_FORCE_ZX_INIT_PROBE = prevForce;
  }
});
