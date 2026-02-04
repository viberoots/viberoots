#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { isImporterScopedLockfileLabel, parseLockfileLabel } from "../../lib/labels";

test("parseLockfileLabel: root importer '.'", () => {
  const s = "lockfile:pnpm-lock.yaml#.";
  const parsed = parseLockfileLabel(s);
  assert.ok(parsed, "should parse");
  assert.equal(parsed!.lockfile, "pnpm-lock.yaml");
  assert.equal(parsed!.importer, ".");
  assert.equal(isImporterScopedLockfileLabel(s), true);
});
