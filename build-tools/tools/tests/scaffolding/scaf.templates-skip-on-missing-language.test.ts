#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("scaf templates: skips missing languages with exit 0", async () => {
  await runInTemp("scaf-skip-missing-lang", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    // No build-tools/tools/nix/templates/rust.nix present → should skip with exit 0
    await $`node build-tools/tools/scaffolding/scaf.ts templates rust`;
  });
});
