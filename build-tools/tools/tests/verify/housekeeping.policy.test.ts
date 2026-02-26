#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRunNixStoreOptimizeForRequestedTargets } from "../../dev/verify/housekeeping.ts";

test("nix store optimize runs only for full-suite verify target set", () => {
  assert.equal(shouldRunNixStoreOptimizeForRequestedTargets(["//..."]), true);
  assert.equal(shouldRunNixStoreOptimizeForRequestedTargets(["//projects/apps/my-app/..."]), false);
  assert.equal(shouldRunNixStoreOptimizeForRequestedTargets(["//projects/apps/my-app:app"]), false);
  assert.equal(shouldRunNixStoreOptimizeForRequestedTargets([]), false);
});
