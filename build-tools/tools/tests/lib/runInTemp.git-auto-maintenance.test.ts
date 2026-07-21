#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInScratchTemp } from "./test-helpers/run-in-temp";

test("runInTemp command env disables Git auto-maintenance", async () => {
  const previousXdgCacheHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = "buck-out/tmp/inherited-relative-xdg-cache";
  try {
    await runInScratchTemp("git-auto-maintenance", async (_tmp, $) => {
      assert.equal(String((await $`git config --get maintenance.auto`).stdout).trim(), "false");
      assert.equal(String((await $`git config --get gc.auto`).stdout).trim(), "0");
      assert.equal(String((await $`git config --get gc.autoDetach`).stdout).trim(), "false");
      assert.equal(path.isAbsolute(process.env.XDG_CACHE_HOME || ""), true);
      assert.notEqual(
        process.env.XDG_CACHE_HOME,
        "buck-out/tmp/inherited-relative-xdg-cache",
        "temp commands must not resolve an inherited relative XDG cache inside their cwd",
      );
    });
  } finally {
    if (previousXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousXdgCacheHome;
  }
});
