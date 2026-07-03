#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { ownerPidForIsolation } from "../../dev/buck-watchdog-lib";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("ownerPidForIsolation parses only pid-owned isolations", () => {
  assert.equal(ownerPidForIsolation("v-123"), 123);
  assert.equal(ownerPidForIsolation("v-123-main"), 123);
  assert.equal(ownerPidForIsolation("verify-nested-123-deadbeefcafe"), 123);
  assert.equal(ownerPidForIsolation("zxtest-456"), 456);
  assert.equal(ownerPidForIsolation("exporter-789"), 789);
  assert.equal(ownerPidForIsolation("devbuild-321"), 321);
  assert.equal(ownerPidForIsolation("devbuild-321-extra"), 321);

  assert.equal(ownerPidForIsolation("devbuild-shared-1a82e8dd60"), null);
  assert.equal(ownerPidForIsolation("exporter-shared-1a82e8dd60"), null);
  assert.equal(ownerPidForIsolation("verify-nested-deadbeefcafe"), null);
  assert.equal(ownerPidForIsolation("foo-123"), null);
  assert.equal(ownerPidForIsolation(""), null);
});

test("verify watchdog does not sweep verify-owned isolations while parent is alive", async () => {
  const processControl = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/verify/process-control.ts"),
    "utf8",
  );
  const watchdog = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/buck-watchdog.ts"),
    "utf8",
  );

  assert.match(processControl, /--patterns v-,verify-nested-/);
  assert.match(processControl, /--sweep-while-parent-alive 0/);
  assert.match(watchdog, /sweepWhileParentAlive/);
});
