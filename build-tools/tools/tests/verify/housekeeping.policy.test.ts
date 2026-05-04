#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRunNixStoreOptimizeForRequestedTargets } from "../../dev/verify/housekeeping";

test("nix store optimize is opt-in even for full-suite verify target sets", () => {
  assert.equal(shouldRunNixStoreOptimizeForRequestedTargets(["//..."], {}), false);
  assert.equal(
    shouldRunNixStoreOptimizeForRequestedTargets(["//projects/apps/my-app/..."], {
      VERIFY_NIX_OPTIMISE: "1",
    }),
    true,
  );
  assert.equal(
    shouldRunNixStoreOptimizeForRequestedTargets(["//projects/apps/my-app:app"], {
      VERIFY_NIX_OPTIMIZE: "true",
    }),
    true,
  );
  assert.equal(
    shouldRunNixStoreOptimizeForRequestedTargets([], { VERIFY_NIX_OPTIMISE: "0" }),
    false,
  );
});
