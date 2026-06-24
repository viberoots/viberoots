#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInScratchTemp } from "./test-helpers/run-in-temp";

test("runInTemp command env disables Git auto-maintenance", async () => {
  await runInScratchTemp("git-auto-maintenance", async (_tmp, $) => {
    assert.equal(String((await $`git config --get maintenance.auto`).stdout).trim(), "false");
    assert.equal(String((await $`git config --get gc.auto`).stdout).trim(), "0");
    assert.equal(String((await $`git config --get gc.autoDetach`).stdout).trim(), "false");
  });
});
