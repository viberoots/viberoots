#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";

test("runInTemp caches toolchain probing when CGO is enabled", async () => {
  const prevTiming = process.env.TEST_TIMING;
  const prevEnableCgo = process.env.TEST_ENABLE_CGO;
  const prevCgo = process.env.CGO_ENABLED;
  try {
    process.env.TEST_TIMING = "summary";
    delete process.env.TEST_ENABLE_CGO;
    process.env.CGO_ENABLED = "1";

    const { runInTemp, getTimingCountForLabel } = await import("./test-helpers");

    await runInTemp("cgo-on-1", async (_tmp, _$) => {});
    await runInTemp("cgo-on-2", async (_tmp, _$) => {});

    assert.equal(
      getTimingCountForLabel(
        "toolchain probe (command -v cbuild-tools/lang/clang++/xcrun/llvm-ar/ar)",
      ),
      1,
    );
    const expectedXcrun = process.platform === "darwin" ? 1 : 0;
    assert.equal(getTimingCountForLabel("xcrun --show-sdk-path"), expectedXcrun);
  } finally {
    if (prevTiming === undefined) delete process.env.TEST_TIMING;
    else process.env.TEST_TIMING = prevTiming;

    if (prevEnableCgo === undefined) delete process.env.TEST_ENABLE_CGO;
    else process.env.TEST_ENABLE_CGO = prevEnableCgo;

    if (prevCgo === undefined) delete process.env.CGO_ENABLED;
    else process.env.CGO_ENABLED = prevCgo;
  }
});
