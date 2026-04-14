#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { isNonBuildSystemOnlyVerifyTargets } from "../../dev/verify/target-scope.ts";

test("non-build-system scope detection", () => {
  assert.equal(isNonBuildSystemOnlyVerifyTargets(["//test-workspace/apps/my-app/..."]), true);
  assert.equal(
    isNonBuildSystemOnlyVerifyTargets([
      "//test-workspace/apps/my-app:unit",
      "//test-workspace/libs/demo:unit",
    ]),
    true,
  );
  assert.equal(isNonBuildSystemOnlyVerifyTargets(["//..."]), false);
  assert.equal(isNonBuildSystemOnlyVerifyTargets(["//build-tools/tools/tests/..."]), false);
});
