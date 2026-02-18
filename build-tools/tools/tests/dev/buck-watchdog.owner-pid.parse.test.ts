#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { ownerPidForIsolation } from "../../dev/buck-watchdog-lib.ts";

test("ownerPidForIsolation parses only pid-owned isolations", () => {
  assert.equal(ownerPidForIsolation("v-123"), 123);
  assert.equal(ownerPidForIsolation("v-123-main"), 123);
  assert.equal(ownerPidForIsolation("zxtest-456"), 456);
  assert.equal(ownerPidForIsolation("exporter-789"), 789);
  assert.equal(ownerPidForIsolation("devbuild-321"), 321);
  assert.equal(ownerPidForIsolation("devbuild-321-extra"), 321);

  assert.equal(ownerPidForIsolation("devbuild-shared-1a82e8dd60"), null);
  assert.equal(ownerPidForIsolation("exporter-shared-1a82e8dd60"), null);
  assert.equal(ownerPidForIsolation("foo-123"), null);
  assert.equal(ownerPidForIsolation(""), null);
});
