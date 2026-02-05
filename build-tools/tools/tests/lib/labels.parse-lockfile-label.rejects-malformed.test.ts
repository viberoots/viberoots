#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { isImporterScopedLockfileLabel, parseLockfileLabel } from "../../lib/labels";

test("parseLockfileLabel: rejects malformed labels", () => {
  const bad = [
    "lockfile:projects/apps/web/pnpm-lock.yaml", // missing importer
    "lockfile:#apps/web", // missing path
    "lockfile:projects/apps/web/pnpm-lock.yaml#", // missing importer
    "lockfile:#", // empty parts
    "lockfile:", // empty
    "lockfile", // not a proper prefix form
    "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web#extra", // extra '#'
    "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/api", // importer mismatch
    "lockfile:projects/apps/web/pnpm-lock.yaml#.", // '#.' only allowed for repo-root lockfiles
    "", // empty string
  ];
  for (const s of bad) {
    assert.equal(parseLockfileLabel(s), null, `expected null for '${s}'`);
    assert.equal(isImporterScopedLockfileLabel(s), false, `expected false for '${s}'`);
  }
});
