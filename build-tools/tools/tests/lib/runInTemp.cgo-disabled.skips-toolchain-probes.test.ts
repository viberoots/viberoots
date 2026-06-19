#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";

test("runInTemp skips toolchain probing when CGO is disabled (default)", async () => {
  const prevTiming = process.env.TEST_TIMING;
  const prevEnableCgo = process.env.TEST_ENABLE_CGO;
  const prevCgo = process.env.CGO_ENABLED;
  try {
    process.env.TEST_TIMING = "summary";
    delete process.env.TEST_ENABLE_CGO;
    delete process.env.CGO_ENABLED;

    const { runInTemp, getTimingCountForLabel } = await import("./test-helpers");

    await runInTemp("cgo-off-1", async (_tmp, _$) => {});
    await runInTemp("cgo-off-2", async (_tmp, _$) => {});

    assert.equal(
      getTimingCountForLabel(
        "toolchain probe (command -v cviberoots/build-tools/lang/clang++/xcrun/llvm-ar/ar)",
      ),
      0,
    );
    assert.equal(getTimingCountForLabel("xcrun --show-sdk-path"), 0);
  } finally {
    if (prevTiming === undefined) delete process.env.TEST_TIMING;
    else process.env.TEST_TIMING = prevTiming;

    if (prevEnableCgo === undefined) delete process.env.TEST_ENABLE_CGO;
    else process.env.TEST_ENABLE_CGO = prevEnableCgo;

    if (prevCgo === undefined) delete process.env.CGO_ENABLED;
    else process.env.CGO_ENABLED = prevCgo;
  }
});
