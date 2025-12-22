#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { cwdIsInsideTempRepo, cwdPrefixesForTempRepo } from "./buck-daemon-reaper-utils.ts";

test("buck-daemon-reaper-utils: handles /private<->/var temp path aliasing safely", () => {
  const tmp = "/var/folders/aa/bb/T/test-repo-123";
  const prefixes = cwdPrefixesForTempRepo(tmp);
  assert(prefixes.includes("/var/folders/aa/bb/T/test-repo-123"));
  assert(prefixes.includes("/private/var/folders/aa/bb/T/test-repo-123"));
  assert(prefixes.includes("/var/folders/aa/bb/T/test-repo-123/buck-out"));
  assert(prefixes.includes("/private/var/folders/aa/bb/T/test-repo-123/buck-out"));

  assert.equal(
    cwdIsInsideTempRepo("/private/var/folders/aa/bb/T/test-repo-123/buck-out/v2", tmp),
    true,
  );
  assert.equal(cwdIsInsideTempRepo("/var/folders/aa/bb/T/test-repo-123/.buck/buckd", tmp), true);
  assert.equal(
    cwdIsInsideTempRepo("/private/var/folders/aa/bb/T/other-repo/buck-out/v2", tmp),
    false,
  );
  assert.equal(cwdIsInsideTempRepo("/Users/kiltyj/Code/bucknix-fresh/buck-out/v2", tmp), false);
});
