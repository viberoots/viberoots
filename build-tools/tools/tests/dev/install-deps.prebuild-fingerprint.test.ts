#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("install-deps records final prebuild fingerprint after final lock repair", async () => {
  const text = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/install/deps-main.ts"),
    "utf8",
  );

  assert.match(text, /writeGlueFingerprint/);
  assert.doesNotMatch(text, /listFreshnessOutputs\(listOutputs\(\)\)/);

  const finalRepair = text.indexOf('phase: "final"');
  const finalFingerprint = text.indexOf("writeFinalPrebuildFingerprint({ dryRun, skipGlue })");
  assert.ok(finalRepair >= 0, "expected final workspace lock repair path");
  assert.ok(
    finalFingerprint > finalRepair,
    "expected fingerprint after final workspace lock repair",
  );
});
