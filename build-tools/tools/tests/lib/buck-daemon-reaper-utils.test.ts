#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cwdIsInsideTempRepo,
  cwdPrefixesForTempRepo,
  rootIsSameOrInsideTempRepo,
  tempRootsForScopedReap,
} from "./buck-daemon-reaper-utils";

test("buck-daemon-reaper-utils: handles /private temp path aliasing safely", () => {
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
  assert.equal(cwdIsInsideTempRepo("/Users/kiltyj/Code/viberoots/buck-out/v2", tmp), false);

  assert.equal(
    cwdIsInsideTempRepo(
      "/private/tmp/viberoots-verify-user.noindex/tmpdir/test-repo-123/consumer-a/buck-out/v2",
      "/tmp/viberoots-verify-user.noindex/tmpdir/test-repo-123",
    ),
    true,
  );
});

test("buck-daemon-reaper-utils: scoped reaps keep concurrent temp roots separate", () => {
  const outerA = "/private/tmp/viberoots-run-a";
  const outerB = "/private/tmp/viberoots-run-b";

  assert.equal(rootIsSameOrInsideTempRepo("/tmp/viberoots-run-a/consumer-a", outerA), true);
  assert.equal(rootIsSameOrInsideTempRepo("/tmp/viberoots-run-b/consumer-a", outerA), false);
  assert.equal(rootIsSameOrInsideTempRepo("/Users/kiltyj/Code/viberoots", outerA), false);

  assert.deepEqual(
    tempRootsForScopedReap(outerA, [
      "/Users/kiltyj/Code/viberoots",
      "/tmp/viberoots-run-a",
      "/tmp/viberoots-run-a/consumer-a",
      "/tmp/viberoots-run-a/consumer-b",
      "/tmp/viberoots-run-b",
      "/tmp/viberoots-run-b/consumer-a",
      "/tmp/viberoots-run-b/consumer-b",
    ]),
    [
      outerA,
      "/tmp/viberoots-run-a",
      "/tmp/viberoots-run-a/consumer-a",
      "/tmp/viberoots-run-a/consumer-b",
    ],
  );
});
