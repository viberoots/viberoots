#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { isProjectsOnlyVerifyTargets } from "../../dev/verify/target-scope.ts";

test("projects-only scope detection", () => {
  assert.equal(isProjectsOnlyVerifyTargets(["//projects/apps/my-app/..."]), true);
  assert.equal(
    isProjectsOnlyVerifyTargets(["//projects/apps/my-app:unit", "//projects/libs/demo:unit"]),
    true,
  );
  assert.equal(isProjectsOnlyVerifyTargets(["//..."]), false);
  assert.equal(isProjectsOnlyVerifyTargets(["//build-tools/tools/tests/..."]), false);
});
