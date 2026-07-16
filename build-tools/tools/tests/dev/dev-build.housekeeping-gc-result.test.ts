#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { gcClientResultAccepted } from "../../dev/dev-build/housekeeping-gc-result";

const GiB = 1024 ** 3;

test("GC timeout result accepts a quiescent partial reclamation above the hard free-space floor", () => {
  assert.equal(
    gcClientResultAccepted({
      afterBytes: 8 * GiB,
      exitCode: 124,
    }),
    true,
  );
});

test("GC timeout result rejects final capacity below the hard free-space floor", () => {
  assert.equal(
    gcClientResultAccepted({
      afterBytes: 8 * GiB - 1,
      exitCode: 124,
    }),
    false,
  );
});

test("GC timeout result accepts zero observed gain when final capacity is above the hard floor", () => {
  assert.equal(gcClientResultAccepted({ afterBytes: 9 * GiB, exitCode: 124 }), true);
});

test("GC result rejects non-timeout failures despite sufficient reclamation", () => {
  assert.equal(gcClientResultAccepted({ afterBytes: 9 * GiB, exitCode: 1 }), false);
});
