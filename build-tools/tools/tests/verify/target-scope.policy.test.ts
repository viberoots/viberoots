#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { isNonBuildSystemOnlyVerifyTargets } from "../../dev/verify/target-scope";

test("non-build-system scope detection", () => {
  assert.equal(isNonBuildSystemOnlyVerifyTargets(["//projects/apps/my-app/..."]), true);
  assert.equal(
    isNonBuildSystemOnlyVerifyTargets(["//projects/apps/my-app:unit", "//projects/libs/demo:unit"]),
    true,
  );
  assert.equal(isNonBuildSystemOnlyVerifyTargets(["//..."]), false);
  assert.equal(isNonBuildSystemOnlyVerifyTargets(["//build-tools/tools/tests/..."]), false);
});
