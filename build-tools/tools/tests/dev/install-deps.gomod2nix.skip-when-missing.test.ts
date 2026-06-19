#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("install-deps gomod2nix skips when go.mod and go.sum missing", async () => {
  await runInTemp("install-deps-skip", async (tmp, $) => {
    const { stdout } = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env },
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs ./viberoots/build-tools/tools/dev/install-deps.ts --dry-run`;
    const out = String(stdout);
    if (!out.includes("[gomod2nix] skip: no go.mod or go.sum present")) {
      console.error("expected skip message when no go.mod or go.sum");
      process.exit(2);
    }
  });
});
