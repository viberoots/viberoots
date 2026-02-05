#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { isImporterScopedLockfileLabel, parseLockfileLabel } from "../../lib/labels";

test("parseLockfileLabel: nested importer path", () => {
  const s = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web";
  const parsed = parseLockfileLabel(s);
  assert.ok(parsed, "should parse");
  assert.equal(parsed!.lockfile, "projects/apps/web/pnpm-lock.yaml");
  assert.equal(parsed!.importer, "projects/apps/web");
  assert.equal(isImporterScopedLockfileLabel(s), true);
});
